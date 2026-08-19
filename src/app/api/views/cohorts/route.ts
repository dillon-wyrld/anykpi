import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and, gte, sql } from "drizzle-orm";

function detectSmile(weeks: number[]): boolean {
  if (weeks.length < 4) return false;

  const lastThree = weeks.slice(-3).filter((w) => w !== null);
  if (lastThree.length < 3) return false;

  const diffs = [];
  for (let i = 1; i < lastThree.length; i++) {
    diffs.push(lastThree[i] - lastThree[i - 1]);
  }

  const avgDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return avgDiff > -2 && lastThree[lastThree.length - 1] > 20;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get("workspace") || "demo";

  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .all();

  const activities = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspace))
    .all();

  const cohortMap = new Map<string, { signups: Set<string>; retention: Map<number, Set<string>> }>();

  users.forEach((user) => {
    if (!user.signupDate) return;
    const weekNum = Math.floor(
      (user.signupDate.getTime() - new Date("2024-01-01").getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    const cohortKey = `2024-W${(weekNum + 1).toString().padStart(2, "0")}`;

    if (!cohortMap.has(cohortKey)) {
      cohortMap.set(cohortKey, {
        signups: new Set(),
        retention: new Map(),
      });
    }
    cohortMap.get(cohortKey)!.signups.add(user.personId);
  });

  activities.forEach((activity) => {
    const user = users.find((u) => u.personId === activity.personId);
    if (!user || !user.signupDate) return;

    const signupWeek = Math.floor(
      (user.signupDate.getTime() - new Date("2024-01-01").getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    const activityWeek = Math.floor(
      (activity.timestamp.getTime() - new Date("2024-01-01").getTime()) / (7 * 24 * 60 * 60 * 1000)
    );
    const weekOffset = activityWeek - signupWeek;

    if (weekOffset >= 0 && weekOffset < 8) {
      const cohortKey = `2024-W${(signupWeek + 1).toString().padStart(2, "0")}`;
      const cohort = cohortMap.get(cohortKey);
      if (cohort) {
        if (!cohort.retention.has(weekOffset)) {
          cohort.retention.set(weekOffset, new Set());
        }
        cohort.retention.get(weekOffset)!.add(user.personId);
      }
    }
  });

  const cohorts = Array.from(cohortMap.entries())
    .map(([cohortKey, data]) => {
      const signupCount = data.signups.size;
      const weeks = Array.from({ length: 8 }, (_, i) => {
        const retained = data.retention.get(i)?.size || 0;
        return signupCount > 0 ? Math.round((retained / signupCount) * 100) : 0;
      });

      // Extract week number from cohortKey (e.g. "2024-W05")
      const weekMatch = cohortKey.match(/W(\d+)/);
      const weekNum = weekMatch ? parseInt(weekMatch[1]) : 1;
      const cohortDate = new Date(2024, 0, 1 + (weekNum - 1) * 7);

      return {
        cohort: cohortKey,
        cohortDate: cohortDate.toISOString().split('T')[0],
        size: signupCount,
        weeks,
        smileDetected: detectSmile(weeks),
      };
    })
    .sort((a, b) => a.cohort.localeCompare(b.cohort));

  return NextResponse.json({ cohorts });
}
