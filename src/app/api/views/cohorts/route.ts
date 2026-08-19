import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";

const CO_MINSIZE = 3;
const CO_LEVEL = 25;
const CO_DECAY = 0.02;

interface CohortRow {
  week: number;
  label: string;
  size: number;
  retention: number[];
  counts: number[];
  state: "young" | "smile" | "low" | "sliding";
  grade: {
    slope: number;
    floor: number;
    decay: number;
    thin?: boolean;
  };
}

const GRAINS: Record<string, { name: string; per: string; units: string; pre: string; d: number }> = {
  day: { name: "Daily", per: "day", units: "days", pre: "D", d: 1 },
  week: { name: "Weekly", per: "week", units: "weeks", pre: "W", d: 7 },
  biweek: { name: "Biweekly", per: "fortnight", units: "fortnights", pre: "W", d: 14 },
  month: { name: "Monthly", per: "month", units: "months", pre: "M", d: 30 },
  quarter: { name: "Quarterly", per: "quarter", units: "quarters", pre: "Q", d: 90 },
};

function leastSquaresSlope(ret: number[], from: number): number {
  const n = ret.length - from;
  if (n < 3) return 0;
  
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = from; i < ret.length; i++) {
    const p = i - from;
    sx += p;
    sy += ret[i];
    sxy += p * ret[i];
    sxx += p * p;
  }
  const d = n * sxx - sx * sx;
  return d ? (n * sxy - sx * sy) / d : 0;
}

function gradeCohort(
  cohort: { retention: number[]; size: number },
  G: number
): {
  state: "young" | "smile" | "low" | "sliding";
  slope: number;
  floor: number;
  decay: number;
  thin?: boolean;
} {
  const ret = cohort.retention;
  
  if (cohort.size < CO_MINSIZE) {
    return { state: "young", slope: 0, floor: 0, decay: 0, thin: true };
  }
  
  if (ret.length < 4) {
    return { state: "young", slope: 0, floor: 0, decay: 0 };
  }
  
  const from = Math.max(1, Math.round(28 / G));
  const slope = leastSquaresSlope(ret, from);
  const win = ret.slice(from);
  const base = Math.max(1, win.reduce((a, b) => a + b, 0) / win.length);
  const decay = ((slope * 7) / G) / base;
  const floor = ret.slice(-5).reduce((a, b) => a + b, 0) / 5;
  
  const state: "young" | "smile" | "low" | "sliding" =
    decay < -CO_DECAY ? "sliding" : floor < CO_LEVEL ? "low" : "smile";
  
  return { state, slope, floor, decay };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspace = searchParams.get("workspace") || "demo";
  const grainParam = searchParams.get("grain") || "week";

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

  // Derive date window from actual data, not hardcoded 2024-01-01
  let minTimestamp = new Date();
  let maxTimestamp = new Date(0);
  
  users.forEach(u => {
    if (u.signupDate) {
      if (u.signupDate < minTimestamp) minTimestamp = u.signupDate;
      if (u.signupDate > maxTimestamp) maxTimestamp = u.signupDate;
    }
  });
  
  activities.forEach(a => {
    if (a.timestamp < minTimestamp) minTimestamp = a.timestamp;
    if (a.timestamp > maxTimestamp) maxTimestamp = a.timestamp;
  });
  
  // Start at UTC midnight of earliest date
  const baseDate = new Date(Date.UTC(
    minTimestamp.getUTCFullYear(),
    minTimestamp.getUTCMonth(),
    minTimestamp.getUTCDate()
  ));
  
  const totalDays = Math.max(
    168,
    Math.ceil((maxTimestamp.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );

  const enrichedUsers = users
    .filter((u) => u.signupDate)
    .map((user) => {
      const signupDay = Math.floor(
        (user.signupDate!.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000)
      );

      const dailyActivity = new Array(totalDays).fill(false);

      activities
        .filter((a) => a.personId === user.personId)
        .forEach((activity) => {
          const dayIndex = Math.floor(
            (activity.timestamp.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000)
          );
          if (dayIndex >= 0 && dayIndex < totalDays) {
            dailyActivity[dayIndex] = true;
          }
        });

      return {
        personId: user.personId,
        name: user.name,
        emoji: user.emoji,
        signupDay,
        dailyActivity,
      };
    });

  // Precompute cohorts server-side
  const grain = GRAINS[grainParam] || GRAINS.week;
  const G = grain.d;
  const cohortRows: CohortRow[] = [];
  const maxPeriods = Math.ceil(totalDays / G);
  
  for (let b = 0; b < maxPeriods; b++) {
    const start = b * G;
    const cohortUsers = enrichedUsers.filter(
      (u) => Math.floor(u.signupDay / G) === b
    );
    
    if (cohortUsers.length === 0) continue;
    
    const retention: number[] = [];
    const counts: number[] = [];
    
    for (let p = 0; p < maxPeriods - b; p++) {
      const periodStart = start + p * G;
      const periodEnd = Math.min(totalDays, periodStart + G);
      
      let activeCount = 0;
      cohortUsers.forEach((u) => {
        for (let d = periodStart; d < periodEnd; d++) {
          if (u.dailyActivity[d]) {
            activeCount++;
            break;
          }
        }
      });
      
      counts.push(activeCount);
      retention.push(
        cohortUsers.length > 0
          ? Math.round((activeCount / cohortUsers.length) * 100)
          : 0
      );
    }
    
    const grade = gradeCohort({ retention, size: cohortUsers.length }, G);
    const label =
      G === 1
        ? `D${b + 1}`
        : G === 7
        ? `W${b + 1}`
        : grain.pre === "W"
        ? `W${start / 7 + 1}–${Math.min(24, start / 7 + G / 7)}`
        : `${grain.pre}${b + 1}`;
    
    cohortRows.push({
      week: b,
      label,
      size: cohortUsers.length,
      retention,
      counts,
      state: grade.state,
      grade,
    });
  }

  return NextResponse.json({
    cohorts: cohortRows,
    users: enrichedUsers,
    baseDate: baseDate.toISOString(),
    totalDays,
  });
}
