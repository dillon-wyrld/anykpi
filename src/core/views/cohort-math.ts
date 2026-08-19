/**
 * Cohort retention / smile / grade — the numbers on the cohort table, curves,
 * and insight cards.
 *
 * Grading constants and slope/floor/decay are the existing view-builder rules
 * (`src/core/views/cohorts.ts`). Insight cards keep the on-screen copy
 * thresholds that the Cohorts component already prints.
 */

export const CO_MINSIZE = 3;
export const CO_LEVEL = 25;
export const CO_DECAY = 0.02;
export const COHORT_MIN_DAYS = 168;

/** On-screen smile-card copy (unchanged from the Cohorts component). */
export const SMILE_COPY_DECAY = 0.035;
export const SMILE_COPY_LEVEL = 20;
export const CO_MINN = 15;

export const GRAINS: Record<
  string,
  { name: string; per: string; units: string; pre: string; d: number }
> = {
  day: { name: "Daily", per: "day", units: "days", pre: "D", d: 1 },
  week: { name: "Weekly", per: "week", units: "weeks", pre: "W", d: 7 },
  biweek: { name: "Biweekly", per: "fortnight", units: "fortnights", pre: "W", d: 14 },
  month: { name: "Monthly", per: "month", units: "months", pre: "M", d: 30 },
  quarter: { name: "Quarterly", per: "quarter", units: "quarters", pre: "Q", d: 90 },
};

export type CohortState = "young" | "smile" | "low" | "sliding";

export interface CohortGrade {
  state: CohortState;
  slope: number;
  floor: number;
  decay: number;
  thin?: boolean;
}

export interface CohortRow {
  week: number;
  label: string;
  size: number;
  retention: number[];
  counts: number[];
  state: CohortState;
  smileDetected: boolean;
  grade: CohortGrade;
}

export interface CohortUser {
  personId: string;
  name: string;
  emoji: string;
  signupDay: number;
  dailyActivity: boolean[];
}

/** Least-squares slope in points per period. Existing view-builder fit. */
export function coSlope(ret: number[], from: number): number {
  const n = ret.length - from;
  if (n < 3) return 0;

  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0;
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

/** Mean of the last five retention points — the smile floor. */
export function coFloorOf(ret: number[]): number {
  const tail = ret.slice(-5);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

/** Existing smile / floor / decay rules used by `loadCohortsView`. */
export function coGrade(
  cohort: { retention: number[]; size: number },
  G: number
): CohortGrade {
  const ret = cohort.retention;

  if (cohort.size < CO_MINSIZE) {
    return { state: "young", slope: 0, floor: 0, decay: 0, thin: true };
  }

  if (ret.length < 4) {
    return { state: "young", slope: 0, floor: 0, decay: 0 };
  }

  const from = Math.max(1, Math.round(28 / G));
  const slope = coSlope(ret, from);
  const win = ret.slice(from);
  const base = Math.max(1, win.reduce((a, b) => a + b, 0) / win.length);
  const decay = (slope * 7) / G / base;
  const floor = coFloorOf(ret);

  const state: CohortState =
    decay < -CO_DECAY ? "sliding" : floor < CO_LEVEL ? "low" : "smile";

  return { state, slope, floor, decay };
}

export function cohortLabel(
  grain: { pre: string; d: number },
  bucket: number
): string {
  const G = grain.d;
  const start = bucket * G;
  if (G === 1) return `D${bucket + 1}`;
  if (G === 7) return `W${bucket + 1}`;
  if (grain.pre === "W") {
    return `W${start / 7 + 1}–${Math.min(24, start / 7 + G / 7)}`;
  }
  return `${grain.pre}${bucket + 1}`;
}

export function periodRetention(
  users: Array<{ dailyActivity: boolean[] }>,
  periodStart: number,
  periodEnd: number
): { count: number; pct: number } {
  let activeCount = 0;
  users.forEach((u) => {
    for (let d = periodStart; d < periodEnd; d++) {
      if (u.dailyActivity[d]) {
        activeCount++;
        break;
      }
    }
  });
  return {
    count: activeCount,
    pct: users.length > 0 ? Math.round((activeCount / users.length) * 100) : 0,
  };
}

export function buildCohortRows(
  users: CohortUser[],
  grainParam = "week",
  totalDays: number
): CohortRow[] {
  const grain = GRAINS[grainParam] || GRAINS.week;
  const G = grain.d;
  const rows: CohortRow[] = [];
  const maxPeriods = Math.ceil(totalDays / G);

  for (let b = 0; b < maxPeriods; b++) {
    const start = b * G;
    const cohortUsers = users.filter((u) => Math.floor(u.signupDay / G) === b);
    if (cohortUsers.length === 0) continue;

    const retention: number[] = [];
    const counts: number[] = [];

    for (let p = 0; p < maxPeriods - b; p++) {
      const periodStart = start + p * G;
      const periodEnd = Math.min(totalDays, periodStart + G);
      const { count, pct } = periodRetention(cohortUsers, periodStart, periodEnd);
      counts.push(count);
      retention.push(pct);
    }

    const grade = coGrade({ retention, size: cohortUsers.length }, G);
    rows.push({
      week: b,
      label: cohortLabel(grain, b),
      size: cohortUsers.length,
      retention,
      counts,
      state: grade.state,
      smileDetected: grade.state === "smile",
      grade,
    });
  }

  return rows;
}

export function smileTest(cohorts: Array<{ state: CohortState }>): {
  aged: number;
  smilers: number;
  low: number;
  sliding: number;
  pmfLit: boolean;
} {
  const aged = cohorts.filter((r) => r.state !== "young").length;
  const smilers = cohorts.filter((r) => r.state === "smile").length;
  const low = cohorts.filter((r) => r.state === "low").length;
  const sliding = cohorts.filter((r) => r.state === "sliding").length;
  return {
    aged,
    smilers,
    low,
    sliding,
    pmfLit: aged > 0 && smilers / aged >= 0.5,
  };
}

export interface LeakResult {
  cliff: { p: number; drop: number };
  worst: { p: number; drop: number };
}

export function findLeak(
  cohorts: Array<{ retention: number[] }>
): LeakResult | null {
  const maxPeriods = Math.max(0, ...cohorts.map((r) => r.retention.length));
  const transitions: { p: number; drop: number }[] = [];

  for (let p = 1; p < maxPeriods; p++) {
    let d = 0,
      k = 0;
    cohorts.forEach((c) => {
      if (p < c.retention.length) {
        d += c.retention[p - 1] - c.retention[p];
        k++;
      }
    });
    if (k >= Math.max(2, Math.ceil(cohorts.length * 0.2))) {
      transitions.push({ p, drop: d / k });
    }
  }

  if (transitions.length <= 1) return null;
  return {
    cliff: transitions[0],
    worst: transitions
      .slice(1)
      .reduce((a, b) => (b.drop > a.drop ? b : a), transitions[1]),
  };
}

export function bestVintage<T extends { retention: number[]; size: number }>(
  cohorts: T[],
  minN = CO_MINN
): { vintage: T; period: number } | null {
  const maxPeriods = Math.max(0, ...cohorts.map((r) => r.retention.length));
  const bestPeriod = Math.min(3, maxPeriods - 1);
  if (bestPeriod < 1) return null;

  let winner: T | null = null;
  cohorts.forEach((r) => {
    if (r.retention.length > bestPeriod && r.size >= minN) {
      if (!winner || r.retention[bestPeriod] > winner.retention[bestPeriod]) {
        winner = r;
      }
    }
  });
  return winner ? { vintage: winner, period: bestPeriod } : null;
}

export function cohortBenchmark(
  cohorts: Array<{ retention: number[]; counts: number[]; size: number }>,
  cols?: number
): number[] {
  const width =
    cols ?? Math.max(0, ...cohorts.map((r) => r.retention.length));
  const benchmark: number[] = [];
  for (let p = 0; p < width; p++) {
    let num = 0,
      den = 0;
    cohorts.forEach((c) => {
      if (p < c.retention.length) {
        num += c.counts[p];
        den += c.size;
      }
    });
    benchmark.push(den ? Math.round((100 * num) / den) : 0);
  }
  return benchmark;
}

/**
 * Users active on every day of the first 8 weeks after signup, counted only
 * in cohorts that have at least 8 retention periods — existing card rule.
 */
export function loyalCoreCount(
  users: Array<{ signupDay: number; dailyActivity: boolean[] }>,
  cohorts: Array<{ week: number; retention: number[] }>,
  grainDays: number
): number {
  return cohorts
    .filter((r) => r.retention.length >= 8)
    .reduce(
      (sum, r) =>
        sum +
        users.filter((u) => {
          const cohortIdx = Math.floor(u.signupDay / grainDays);
          return (
            cohortIdx === r.week &&
            u.dailyActivity.slice(u.signupDay, u.signupDay + 56).filter(Boolean)
              .length >= 56
          );
        }).length,
      0
    );
}

export function cohortWindow(
  dates: Array<Date | null | undefined>,
  minDays = COHORT_MIN_DAYS
): { baseDate: Date; totalDays: number } {
  let minTimestamp = new Date();
  let maxTimestamp = new Date(0);

  dates.forEach((date) => {
    if (!date) return;
    if (date < minTimestamp) minTimestamp = date;
    if (date > maxTimestamp) maxTimestamp = date;
  });

  const baseDate = new Date(
    Date.UTC(
      minTimestamp.getUTCFullYear(),
      minTimestamp.getUTCMonth(),
      minTimestamp.getUTCDate()
    )
  );

  const totalDays = Math.max(
    minDays,
    Math.ceil((maxTimestamp.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24)) +
      1
  );

  return { baseDate, totalDays };
}
