/**
 * Connector interface, registry, and `sync(source)` entry point.
 *
 * Cursor contract (consumed later by incremental / scheduled sync):
 * - `opts.cursor` is an opaque string this connector previously returned as
 *   `nextCursor`. Callers persist it per (workspaceId, source) and pass it
 *   back unchanged. A missing cursor means "start from the beginning"
 *   (first page or a full snapshot).
 * - `nextCursor` is the watermark to store after this attempt. `null` means
 *   this run is complete and there is no further page. Connectors that do
 *   not yet support incremental pulls ignore `opts.cursor` and return
 *   `nextCursor: null` after a full snapshot.
 * - Advance the stored cursor **only** when `health === "ok"`. On
 *   `degraded` or `error`, retry with the same `opts.cursor`.
 * - Incremental sources persist that watermark in the per-(workspaceId,
 *   source) sync_state slot (`loadSyncCursor` / `saveSyncCursor`).
 *
 * Health contract (consumed later by incremental / scheduled sync):
 * - `ok` — writes finished; safe to persist `nextCursor` and treat the
 *   source as healthy.
 * - `degraded` — some rows landed but the run is incomplete or stale
 *   (partial page, skipped endpoint). Do not advance the cursor; retry.
 * - `error` — the run failed. `error` may carry a short, non-secret
 *   reason. Do not advance the cursor; surface the source as unhealthy.
 *
 * Config contract:
 * - The registry loads decrypted source config and passes it as
 *   `opts.config`. Connectors must not log it.
 * - Env vars (POSTHOG_*, MIXPANEL_*, AMPLITUDE_*, STRIPE_*, REVENUECAT_*,
 *   MERCURY_*) are a deprecated read-only fallback when stored config is
 *   missing a field.
 */

import { and, eq } from "drizzle-orm";
import { refreshWorkspaceClusters } from "@/core/clustering";
import { persistWorkspaceMilestones } from "@/core/milestones";
import { SyncResultSchema, type SyncResult } from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadSourceConfig } from "@/core/sources";
import { upsertSyncState } from "@/core/upsert";
import { syncAmplitude } from "./amplitude";
import { loadSyncCursor, saveSyncCursor } from "./cursor";
import { ICS_SOURCE, ICS_SOURCE_NAME, syncIcs } from "./ics";
import { withSourceLock } from "./lock";
import { syncMercury } from "./mercury";
import { syncMixpanel } from "./mixpanel";
import { syncPostHog } from "./posthog";
import { syncRevenueCat } from "./revenuecat";
import { syncStripe } from "./stripe";
import type { SyncOpts } from "./types";

export type { SyncOpts } from "./types";
export { loadSyncCursor, saveSyncCursor } from "./cursor";

export type { SyncResult, ConnectorHealth } from "@/core/contracts";
export { SyncResultSchema, ConnectorHealthSchema } from "@/core/contracts";

export { syncAmplitude } from "./amplitude";
export { syncIcs } from "./ics";
export { syncMercury } from "./mercury";
export { syncMixpanel } from "./mixpanel";
export { syncPostHog } from "./posthog";
export { syncRevenueCat } from "./revenuecat";
export { syncStripe } from "./stripe";

export interface Connector {
  source: string;
  name: string;
  sync(workspaceId: string, opts?: SyncOpts): Promise<SyncResult>;
}

export const posthogConnector: Connector = {
  source: "posthog",
  name: "PostHog",
  sync: syncPostHog,
};

export const mixpanelConnector: Connector = {
  source: "mixpanel",
  name: "Mixpanel",
  sync: syncMixpanel,
};

export const amplitudeConnector: Connector = {
  source: "amplitude",
  name: "Amplitude",
  sync: syncAmplitude,
};

export const stripeConnector: Connector = {
  source: "stripe",
  name: "Stripe",
  sync: syncStripe,
};

export const revenuecatConnector: Connector = {
  source: "revenuecat",
  name: "RevenueCat",
  sync: syncRevenueCat,
};

export const mercuryConnector: Connector = {
  source: "mercury",
  name: "Mercury",
  sync: syncMercury,
};

export const icsConnector: Connector = {
  source: ICS_SOURCE,
  name: ICS_SOURCE_NAME,
  sync: syncIcs,
};

/** Registry keyed by `Connector.source`. */
export const registry: Record<string, Connector> = {
  posthog: posthogConnector,
  mixpanel: mixpanelConnector,
  amplitude: amplitudeConnector,
  stripe: stripeConnector,
  revenuecat: revenuecatConnector,
  mercury: mercuryConnector,
  ics: icsConnector,
};

export function listConnectors(): Connector[] {
  return Object.values(registry);
}

export function getConnector(source: string): Connector | undefined {
  return registry[source];
}

export function resolveSources(source?: string | null): string[] {
  if (!source || source === "all") {
    return listConnectors().map((connector) => connector.source);
  }
  return [source];
}

async function markPending(connector: Connector, workspaceId: string): Promise<void> {
  const existing = await db
    .select()
    .from(schema.syncState)
    .where(
      and(
        eq(schema.syncState.workspaceId, workspaceId),
        eq(schema.syncState.source, connector.source)
      )
    )
    .get();

  await upsertSyncState({
    source: connector.source,
    sourceName: connector.name,
    lastSync: existing?.lastSync ?? null,
    status: "pending",
    error: null,
    workspaceId,
  });
}

async function markError(connector: Connector, workspaceId: string): Promise<void> {
  await upsertSyncState({
    source: connector.source,
    sourceName: connector.name,
    lastSync: new Date(),
    status: "error",
    error: "sync failed",
    workspaceId,
  });
}

const INCREMENTAL_SOURCES = new Set(["posthog", "mixpanel", "amplitude"]);

async function runSource(
  connector: Connector,
  workspaceId: string,
  opts?: SyncOpts
): Promise<SyncResult> {
  await markPending(connector, workspaceId);
  try {
    const stored = await loadSourceConfig(workspaceId, connector.source);
    const cursor =
      opts?.cursor ??
      (INCREMENTAL_SOURCES.has(connector.source)
        ? await loadSyncCursor(workspaceId, connector.source)
        : undefined);
    const result = SyncResultSchema.parse(
      await connector.sync(workspaceId, {
        ...opts,
        cursor,
        config: stored ?? opts?.config,
      })
    );
    if (result.health === "ok") {
      if (INCREMENTAL_SOURCES.has(connector.source)) {
        await saveSyncCursor(workspaceId, connector.source, result.nextCursor);
      }
      await refreshWorkspaceClusters(workspaceId);
      await persistWorkspaceMilestones(workspaceId);
    }
    return result;
  } catch {
    await markError(connector, workspaceId);
    return {
      rowsSynced: 0,
      nextCursor: null,
      health: "error",
      error: "sync failed",
    };
  }
}

export async function sync(
  source: string,
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const connector = registry[source];
  if (!connector) {
    throw new Error(`Unknown connector source: ${source}`);
  }
  return withSourceLock(workspaceId, source, () =>
    runSource(connector, workspaceId, opts)
  );
}
