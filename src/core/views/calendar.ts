import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import {
  classifyCalendarDate,
  formatSyncAge,
  startOfLocalDay,
} from "@/core/views/calendar-math";
import {
  detectWorkspaceMilestones,
  eventMilestoneKey,
  MILESTONE_SOURCE,
  MILESTONE_SOURCE_COLOR,
  MILESTONE_SOURCE_NAME,
  milestoneToCalValues,
  syntheticMilestoneId,
} from "@/core/milestones";

export { classifyCalendarDate, formatSyncAge } from "@/core/views/calendar-math";

/**
 * Read-only calendar fill. Rows come from connectors and demo seed.
 * There is no authoring path — this loader only projects stored events.
 */
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
  const today = startOfLocalDay(now);
  const anykpiSync = syncMap.get(MILESTONE_SOURCE);

  const mapped = events.map((e) => {
    const sync = syncMap.get(e.source);
    const classified = classifyCalendarDate(e.eventDate, today);

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
      detail:
        e.source === MILESTONE_SOURCE && e.type === "milestone"
          ? e.badge
          : `${e.type} event from ${e.sourceName}`,
      syncAge: formatSyncAge(sync?.lastSync, now),
      isFuture: classified.isFuture,
    };
  });

  const seen = new Set(
    events
      .map((event) => eventMilestoneKey(event, workspace))
      .filter((key): key is string => key !== null)
  );

  const detected = await detectWorkspaceMilestones(workspace, now);
  for (const milestone of detected) {
    if (seen.has(milestone.key)) continue;
    seen.add(milestone.key);
    const row = milestoneToCalValues(milestone, now);
    mapped.push({
      id: syntheticMilestoneId(milestone.key),
      source: MILESTONE_SOURCE,
      sourceName: MILESTONE_SOURCE_NAME,
      sourceColor: MILESTONE_SOURCE_COLOR,
      sourceGlyph: milestone.emoji,
      type: row.type,
      date: milestone.occurredAt.toISOString(),
      title: milestone.title,
      badge: milestone.rule,
      detail: milestone.rule,
      syncAge: formatSyncAge(anykpiSync?.lastSync, now),
      isFuture: classifyCalendarDate(milestone.occurredAt, today).isFuture,
    });
  }

  mapped.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

  return { events: mapped };
}
