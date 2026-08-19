/**
 * Per-source sync cursor (the ANY-44 slot).
 *
 * One watermark per (workspaceId, source) — the same unique pair
 * `sync_state` uses. Stored in `config` so this change does not need a
 * schema migration. Advance only after a successful page; a failed or
 * killed run keeps the last saved cursor so the next run resumes.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertConfig } from "@/core/upsert";

export const SYNC_CURSOR_KEY_PREFIX = "sync.cursor.";

export type SourceCursorPhase = "persons" | "events" | "caught_up";

export type SourceCursor = {
  v: 1;
  phase: SourceCursorPhase;
  /** Next page token or URL. Absent / null means the start of this phase. */
  page?: string | null;
  /** High-water event timestamp (ISO) for incremental pulls. */
  since?: string | null;
};

export function syncCursorKey(source: string): string {
  return `${SYNC_CURSOR_KEY_PREFIX}${source}`;
}

export function encodeSourceCursor(cursor: SourceCursor): string {
  return JSON.stringify(cursor);
}

export function parseSourceCursor(raw?: string | null): SourceCursor {
  if (!raw) return { v: 1, phase: "persons" };
  try {
    const parsed = JSON.parse(raw) as SourceCursor;
    if (
      parsed?.v === 1 &&
      (parsed.phase === "persons" ||
        parsed.phase === "events" ||
        parsed.phase === "caught_up")
    ) {
      return parsed;
    }
  } catch {
    // Ignore malformed watermarks and start from the beginning.
  }
  return { v: 1, phase: "persons" };
}

export function caughtUpCursor(since: string): string {
  return encodeSourceCursor({ v: 1, phase: "caught_up", since });
}

export async function loadSyncCursor(
  workspaceId: string,
  source: string
): Promise<string | undefined> {
  const row = await db
    .select()
    .from(schema.config)
    .where(
      and(
        eq(schema.config.workspaceId, workspaceId),
        eq(schema.config.key, syncCursorKey(source))
      )
    )
    .get();
  return row?.value ? row.value : undefined;
}

export async function saveSyncCursor(
  workspaceId: string,
  source: string,
  cursor: string | null
): Promise<void> {
  const key = syncCursorKey(source);
  if (!cursor) {
    await db
      .delete(schema.config)
      .where(and(eq(schema.config.workspaceId, workspaceId), eq(schema.config.key, key)));
    return;
  }
  await upsertConfig({ key, value: cursor, workspaceId });
}

export function laterIso(
  current: string | null | undefined,
  candidate: string
): string {
  if (!current) return candidate;
  return current > candidate ? current : candidate;
}
