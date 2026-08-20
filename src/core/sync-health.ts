/**
 * Per-source sync health for get_overview / GET /api/v1/overview.
 * Failures are `status: "error"`. /connect renders that plus next-run
 * and a human next step (see `connector-health.ts`).
 */

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { SyncHealthSchema, type SyncHealth } from "@/core/contracts";

export async function loadSyncHealth(workspace: string): Promise<SyncHealth[]> {
  const rows = await db
    .select()
    .from(schema.syncState)
    .where(eq(schema.syncState.workspaceId, workspace))
    .all();

  return rows.map((row) =>
    SyncHealthSchema.parse({
      source: row.source,
      sourceName: row.sourceName,
      status: row.status,
      lastSynced: row.lastSync ? row.lastSync.toISOString() : undefined,
      error: row.error || undefined,
    })
  );
}
