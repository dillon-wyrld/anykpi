/**
 * Idempotent activity / user writes for incremental connector sync.
 * Dedup uses ANY-12's unique (workspaceId, externalId).
 */

import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";

export const ACTIVITY_WRITE_BATCH = 500;

export function classifyEvent(eventName: string): "core" | "search" | "share" | "pay" {
  const eventLower = eventName.toLowerCase();
  if (eventLower.includes("search") || eventLower.includes("query")) return "search";
  if (eventLower.includes("share") || eventLower.includes("invite")) return "share";
  if (
    eventLower.includes("pay") ||
    eventLower.includes("purchase") ||
    eventLower.includes("subscribe")
  ) {
    return "pay";
  }
  return "core";
}

export function activityExternalId(
  source: string,
  input: {
    nativeId?: string | null;
    personId: string;
    timestamp: Date;
    eventName: string;
  }
): string {
  const native = input.nativeId?.trim();
  if (native) return `${source}:${native}`;
  const material = `${source}:${input.personId}:${input.timestamp.toISOString()}:${input.eventName}`;
  return `${source}:${createHash("sha256").update(material).digest("hex")}`;
}

export async function insertUserIfAbsent(row: {
  personId: string;
  name: string;
  email: string | null;
  emoji: string | null;
  platform: string | null;
  country: string | null;
  signupDate: Date;
  workspaceId: string;
}): Promise<number> {
  const existing = await db
    .select({ personId: schema.users.personId })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.personId, row.personId),
        eq(schema.users.workspaceId, row.workspaceId)
      )
    )
    .get();
  if (existing) return 0;
  await db.insert(schema.users).values({
    personId: row.personId,
    name: row.name,
    email: row.email,
    emoji: row.emoji,
    platform: row.platform,
    country: row.country,
    signupDate: row.signupDate,
    cluster: null,
    accountId: null,
    workspaceId: row.workspaceId,
  });
  return 1;
}

export type ActivityWrite = {
  personId: string;
  timestamp: Date;
  eventName: string;
  eventClass: "core" | "search" | "share" | "pay";
  platform: string | null;
  externalId: string;
  workspaceId: string;
};

export async function insertActivitiesIdempotent(
  rows: ActivityWrite[]
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += ACTIVITY_WRITE_BATCH) {
    const batch = rows.slice(i, i + ACTIVITY_WRITE_BATCH);
    const written = await db
      .insert(schema.activity)
      .values(batch)
      .onConflictDoNothing({
        target: [schema.activity.workspaceId, schema.activity.externalId],
      })
      .returning({ id: schema.activity.id });
    inserted += written.length;
  }
  return inserted;
}
