import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import { gate } from "@/core/auth";
import { internalError, logServerError } from "@/core/errors";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requested = searchParams.get("workspace") || "demo";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;
  const workspace = gated.workspace;

  try {

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .all();

  // Derive date window from actual data, not hardcoded 2024-01-01
  let minTimestamp = new Date();
  let maxTimestamp = new Date(0);
  
  users.forEach(u => {
    if (u.signupDate) {
      if (u.signupDate < minTimestamp) minTimestamp = u.signupDate;
      if (u.signupDate > maxTimestamp) maxTimestamp = u.signupDate;
    }
  });
  
  // Query all activities to find the full date range
  const allActivities = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspace))
    .all();
  
  allActivities.forEach(a => {
    if (a.timestamp < minTimestamp) minTimestamp = a.timestamp;
    if (a.timestamp > maxTimestamp) maxTimestamp = a.timestamp;
  });
  
  // Start at UTC midnight of earliest date
  const baseDate = new Date(Date.UTC(
    minTimestamp.getUTCFullYear(),
    minTimestamp.getUTCMonth(),
    minTimestamp.getUTCDate()
  ));
  
  const endDate = new Date(Date.UTC(
    maxTimestamp.getUTCFullYear(),
    maxTimestamp.getUTCMonth(),
    maxTimestamp.getUTCDate() + 1
  ));
  
  const totalDays = Math.max(
    28,
    Math.ceil((endDate.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24))
  );

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

    const activity = Array.from({ length: totalDays }, (_, day) =>
      activityMap.get(user.personId)?.has(day) || false
    );

    const activeCount = activity.filter(Boolean).length;
    let streak = 0;
    for (let d = activity.length - 1; d >= 0 && activity[d]; d--) streak++;
    
    let lastSeen = -1;
    for (let d = activity.length - 1; d >= 0; d--) {
      if (activity[d]) {
        lastSeen = activity.length - 1 - d;
        break;
      }
    }

    return {
      personId: user.personId,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      emoji: user.emoji,
      platform: user.platform,
      country: user.country,
      cluster: user.cluster,
      accountId: user.accountId,
      workspaceId: user.workspaceId,
      incomeBand: user.incomeBand,
      traits: user.traits,
      signupOffset,
      activity,
      cohortMonth: Math.floor(signupOffset / 28),
      activeCount,
      streak,
      lastSeen,
      isNew: signupOffset > 21,
      paid: false,
      churned: lastSeen > 14,
    };
  });

  return NextResponse.json({ users: result, days: 28, baseDate: baseDate.toISOString() });
  } catch {
    logServerError("Dotplot view failed");
    return internalError();
  }
}
