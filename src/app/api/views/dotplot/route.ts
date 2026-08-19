import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and, gte, lte } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get("workspace") || "demo";

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .all();

  const baseDate = new Date("2024-01-01T00:00:00Z");
  const endDate = new Date(baseDate);
  endDate.setDate(endDate.getDate() + 28);

  const activityRecords = await db
    .select()
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.workspaceId, workspace),
        gte(schema.activity.timestamp, baseDate),
        lte(schema.activity.timestamp, endDate)
      )
    )
    .all();

  const activityMap = new Map<string, Set<number>>();
  activityRecords.forEach((record) => {
    const dayOffset = Math.floor(
      (record.timestamp.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (!activityMap.has(record.personId)) {
      activityMap.set(record.personId, new Set());
    }
    activityMap.get(record.personId)!.add(dayOffset);
  });

  const result = users.map((user) => {
    const signupOffset = user.signupDate
      ? Math.floor(
          (user.signupDate.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 0;

    const activity = Array.from({ length: 28 }, (_, day) =>
      activityMap.get(user.personId)?.has(day) || false
    );

    return {
      personId: user.personId,
      name: user.name,
      emoji: user.emoji,
      platform: user.platform,
      country: user.country,
      archetype: user.archetype,
      signupOffset,
      activity,
      cohortMonth: Math.floor(signupOffset / 28),
    };
  });

  return NextResponse.json({ users: result });
}
