import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { formatSyncAge } from "@/core/views/calendar-math";

export { classifyCalendarDate, formatSyncAge } from "@/core/views/calendar-math";

export async function loadCalendarView(workspace: string) {
  const events = await db
    .select()
    .from(schema.calEvents)
    .where(eq(schema.calEvents.workspaceId, workspace))
    .orderBy(schema.calEvents.eventDate)
    .all();

  const syncStates = await db
    .select()
    .from(schema.syncState)
    .where(eq(schema.syncState.workspaceId, workspace))
    .all();

  const syncMap = new Map(syncStates.map((s) => [s.source, s]));
  const now = new Date();

  return {
    events: events.map((e) => {
      const sync = syncMap.get(e.source);

      return {
        id: e.id,
        source: e.source,
        sourceName: e.sourceName,
        sourceColor: e.sourceColor,
        sourceGlyph: e.emoji,
        type: e.type,
        date: e.eventDate.toISOString(),
        title: e.title,
        badge: e.badge,
        detail: `${e.type} event from ${e.sourceName}`,
        syncAge: formatSyncAge(sync?.lastSync, now),
        isFuture: e.isFuture,
      };
    }),
  };
}
