import { db } from "./db";
import * as schema from "./schema";

export type SyncStateUpsert = {
  source: string;
  sourceName: string;
  lastSync?: Date | null;
  status: string;
  error?: string | null;
  workspaceId: string;
};

/**
 * Insert or update sync_state on the unique (workspace_id, source) pair
 * that the table declares. Callers must not target `source` alone.
 */
export async function upsertSyncState(values: SyncStateUpsert): Promise<void> {
  await db
    .insert(schema.syncState)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.syncState.workspaceId, schema.syncState.source],
      set: {
        sourceName: values.sourceName,
        lastSync: values.lastSync,
        status: values.status,
        error: values.error ?? null,
      },
    });
}

export type ConfigUpsert = {
  key: string;
  value: string;
  workspaceId: string;
};

/**
 * Insert or update config on the unique (key, workspace_id) pair
 * that the table declares.
 */
export async function upsertConfig(values: ConfigUpsert): Promise<void> {
  await db
    .insert(schema.config)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.config.key, schema.config.workspaceId],
      set: {
        value: values.value,
      },
    });
}
