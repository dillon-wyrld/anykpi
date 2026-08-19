import type { SyncResult } from "@/core/contracts";
import { upsertSyncState } from "@/core/upsert";

/** Short, non-secret reason for an upstream HTTP failure. */
export function errorFromStatus(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate limited";
  return "sync failed";
}

/**
 * Persist error sync_state and return the contract result for a failed
 * upstream response. Cursor is not advanced.
 */
export async function failedSync(opts: {
  source: string;
  sourceName: string;
  workspaceId: string;
  status: number;
  rowsSynced?: number;
}): Promise<SyncResult> {
  const error = errorFromStatus(opts.status);
  await upsertSyncState({
    source: opts.source,
    sourceName: opts.sourceName,
    lastSync: new Date(),
    status: "error",
    error,
    workspaceId: opts.workspaceId,
  });
  return {
    rowsSynced: opts.rowsSynced ?? 0,
    nextCursor: null,
    health: "error",
    error,
  };
}
