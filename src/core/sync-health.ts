/**
 * Per-source sync health for get_overview / GET /api/v1/overview.
 * Failures are `status: "error"`. /connect renders that plus next-run
 * and a human next step (see `connector-health.ts`).
 */

import { eq } from "drizzle-orm";
import { getConnector } from "@/connectors";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import {
  SyncHealthSchema,
  SyncStateSchema,
  type SyncHealth,
  type SyncState,
} from "@/core/contracts";
import { loadPausedSources } from "@/core/sources";

export async function loadWorkspaceSyncStates(
  workspace: string
): Promise<SyncState[]> {
  const rows = await db
    .select()
    .from(schema.syncState)
    .where(eq(schema.syncState.workspaceId, workspace))
    .all();
  const paused = await loadPausedSources(workspace);

  const states = rows.map((row) =>
    SyncStateSchema.parse({
      source: row.source,
      sourceName: row.sourceName,
      lastSync: row.lastSync?.toISOString(),
      status: row.status as SyncState["status"],
      error: row.error || undefined,
      paused: paused.has(row.source) || undefined,
    })
  );

  for (const source of paused) {
    if (states.some((state) => state.source === source)) continue;
    const connector = getConnector(source);
    states.push(
      SyncStateSchema.parse({
        source,
        sourceName: connector?.name ?? source,
        status: "pending",
        paused: true,
      })
    );
  }

  return states;
}

export async function loadSyncHealth(workspace: string): Promise<SyncHealth[]> {
  const states = await loadWorkspaceSyncStates(workspace);
  return states.map((state) =>
    SyncHealthSchema.parse({
      source: state.source,
      sourceName: state.sourceName,
      status: state.status,
      lastSynced: state.lastSync,
      error: state.error,
      paused: state.paused,
    })
  );
}
