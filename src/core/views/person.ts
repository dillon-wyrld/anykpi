/**
 * Person drill-down read model — timeline, first/last seen, and the
 * ANY-45 revenue block. Callers must not invent a second charge shape.
 */

import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  PersonPanelResponseSchema,
  type PersonPanelResponse,
  type PersonTimelineEvent,
} from "@/core/contracts";
import { loadPersonRevenueBlock } from "@/core/views/revenue";

const EVENT_CLASSES = new Set<PersonTimelineEvent["eventClass"]>([
  "core",
  "search",
  "share",
  "pay",
]);

const TIMELINE_LIMIT = 100;

export function isoWeekLabel(date: Date): string {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function firstLastSeen(
  signupDate: Date | null | undefined,
  eventTimes: Date[]
): { firstSeen: Date | null; lastSeen: Date | null } {
  if (eventTimes.length === 0) {
    return {
      firstSeen: signupDate ?? null,
      lastSeen: signupDate ?? null,
    };
  }
  let first = eventTimes[0];
  let last = eventTimes[0];
  for (const time of eventTimes) {
    if (time < first) first = time;
    if (time > last) last = time;
  }
  return { firstSeen: first, lastSeen: last };
}

function asEventClass(
  value: string
): PersonTimelineEvent["eventClass"] | null {
  if (EVENT_CLASSES.has(value as PersonTimelineEvent["eventClass"])) {
    return value as PersonTimelineEvent["eventClass"];
  }
  return null;
}

export async function loadPersonPanel(
  workspace: string,
  personId: string
): Promise<PersonPanelResponse | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.workspaceId, workspace),
        eq(schema.users.personId, personId)
      )
    )
    .all();

  if (!user) return null;

  const rows = await db
    .select()
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.workspaceId, workspace),
        eq(schema.activity.personId, personId)
      )
    )
    .orderBy(desc(schema.activity.timestamp))
    .limit(TIMELINE_LIMIT)
    .all();

  const events: PersonTimelineEvent[] = [];
  for (const row of rows) {
    const eventClass = asEventClass(row.eventClass);
    if (!eventClass) continue;
    events.push({
      id: row.id,
      timestamp: row.timestamp.toISOString(),
      eventName: row.eventName,
      eventClass,
      platform: row.platform ?? undefined,
    });
  }

  const { firstSeen, lastSeen } = firstLastSeen(
    user.signupDate,
    rows.map((row) => row.timestamp)
  );
  const revenue = await loadPersonRevenueBlock(workspace, personId);

  return PersonPanelResponseSchema.parse({
    personId: user.personId,
    name: user.name,
    emoji: user.emoji ?? null,
    platform: user.platform ?? null,
    country: user.country ?? null,
    cluster: user.cluster ?? null,
    cohort: user.signupDate ? isoWeekLabel(user.signupDate) : null,
    firstSeen: firstSeen ? firstSeen.toISOString() : null,
    lastSeen: lastSeen ? lastSeen.toISOString() : null,
    events,
    revenue,
    workspace,
  });
}
