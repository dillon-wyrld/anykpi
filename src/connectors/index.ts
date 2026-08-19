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
 *
 * Health contract (consumed later by incremental / scheduled sync):
 * - `ok` — writes finished; safe to persist `nextCursor` and treat the
 *   source as healthy.
 * - `degraded` — some rows landed but the run is incomplete or stale
 *   (partial page, skipped endpoint). Do not advance the cursor; retry.
 * - `error` — the run failed. `error` may carry a short, non-secret
 *   reason. Do not advance the cursor; surface the source as unhealthy.
 */

import { refreshWorkspaceClusters } from "@/core/clustering";
import { SyncResultSchema, type SyncResult } from "@/core/contracts";
import { syncAmplitude } from "./amplitude";
import { syncMixpanel } from "./mixpanel";
import { syncPostHog } from "./posthog";

export type { SyncResult, ConnectorHealth } from "@/core/contracts";
export { SyncResultSchema, ConnectorHealthSchema } from "@/core/contracts";

export { syncAmplitude } from "./amplitude";
export { syncMixpanel } from "./mixpanel";
export { syncPostHog } from "./posthog";

export type SyncOpts = {
  cursor?: string;
};

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

/** Registry keyed by `Connector.source`. */
export const registry: Record<string, Connector> = {
  posthog: posthogConnector,
  mixpanel: mixpanelConnector,
  amplitude: amplitudeConnector,
};

export function listConnectors(): Connector[] {
  return Object.values(registry);
}

export function getConnector(source: string): Connector | undefined {
  return registry[source];
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
  const result = SyncResultSchema.parse(await connector.sync(workspaceId, opts));
  if (result.health === "ok") {
    await refreshWorkspaceClusters(workspaceId);
  }
  return result;
}
