import { desc, eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import {
  FreshnessResponseSchema,
  type FreshnessResponse,
} from "@/core/contracts";

/**
 * Last ingest is the most recently inserted activity row (highest id),
 * not max(event timestamp). Seeded rows can sit later in the day than
 * a just-tracked event.
 */
export async function loadFreshness(workspace: string): Promise<FreshnessResponse> {
  const latest = await db
    .select({
      id: schema.activity.id,
      timestamp: schema.activity.timestamp,
    })
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspace))
    .orderBy(desc(schema.activity.id))
    .limit(1)
    .get();

  const syncStates = await db
    .select({
      source: schema.syncState.source,
      lastSync: schema.syncState.lastSync,
    })
    .from(schema.syncState)
    .where(eq(schema.syncState.workspaceId, workspace))
    .all();

  const lastIngest =
    latest?.id != null && latest.timestamp
      ? `${latest.id}:${latest.timestamp.toISOString()}`
      : null;

  return FreshnessResponseSchema.parse({
    workspace,
    lastIngest,
    sources: syncStates.map((row) => ({
      source: row.source,
      lastSync: row.lastSync ? row.lastSync.toISOString() : null,
    })),
  });
}
