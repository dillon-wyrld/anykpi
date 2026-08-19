/**
 * Dot-plot field math — the numbers on each user row.
 *
 * Extracted from `/api/views/dotplot` so unit tests can cover every derived
 * field without going through the route or Playwright.
 */

export const MS_PER_DAY = 1000 * 60 * 60 * 24;
export const DOTPLOT_MIN_DAYS = 28;
export const COHORT_MONTH_DAYS = 28;
export const NEW_USER_AFTER_DAY = 21;
export const CHURNED_AFTER_DAYS = 14;

export function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
}

export function dayOffset(timestamp: Date, baseDate: Date): number {
  return Math.floor((timestamp.getTime() - baseDate.getTime()) / MS_PER_DAY);
}

export function activityWindow(
  dates: Array<Date | null | undefined>,
  minDays = DOTPLOT_MIN_DAYS
): { baseDate: Date; endDate: Date; totalDays: number } {
  let minTimestamp = new Date();
  let maxTimestamp = new Date(0);

  for (const date of dates) {
    if (!date) continue;
    if (date < minTimestamp) minTimestamp = date;
    if (date > maxTimestamp) maxTimestamp = date;
  }

  const baseDate = utcMidnight(minTimestamp);
  const endDate = new Date(
    Date.UTC(
      maxTimestamp.getUTCFullYear(),
      maxTimestamp.getUTCMonth(),
      maxTimestamp.getUTCDate() + 1
    )
  );

  const totalDays = Math.max(
    minDays,
    Math.ceil((endDate.getTime() - baseDate.getTime()) / MS_PER_DAY)
  );

  return { baseDate, endDate, totalDays };
}

export function activityVector(
  dayOffsets: Iterable<number>,
  totalDays: number
): boolean[] {
  const active = new Set<number>();
  for (const day of dayOffsets) {
    if (day >= 0 && day < totalDays) active.add(day);
  }
  return Array.from({ length: totalDays }, (_, day) => active.has(day));
}

export function activeCountOf(activity: boolean[]): number {
  return activity.filter(Boolean).length;
}

/** Consecutive active days counting back from the last cell. */
export function streakOf(activity: boolean[]): number {
  let streak = 0;
  for (let d = activity.length - 1; d >= 0 && activity[d]; d--) streak++;
  return streak;
}

/** Days since last activity, measured from the last cell. `-1` if never active. */
export function lastSeenOf(activity: boolean[]): number {
  for (let d = activity.length - 1; d >= 0; d--) {
    if (activity[d]) return activity.length - 1 - d;
  }
  return -1;
}

export interface DotPlotDerived {
  signupOffset: number;
  activity: boolean[];
  cohortMonth: number;
  activeCount: number;
  streak: number;
  lastSeen: number;
  isNew: boolean;
  paid: boolean;
  churned: boolean;
}

export function deriveDotPlotFields(
  signupOffset: number,
  activity: boolean[]
): DotPlotDerived {
  const lastSeen = lastSeenOf(activity);
  return {
    signupOffset,
    activity,
    cohortMonth: Math.floor(signupOffset / COHORT_MONTH_DAYS),
    activeCount: activeCountOf(activity),
    streak: streakOf(activity),
    lastSeen,
    isNew: signupOffset > NEW_USER_AFTER_DAY,
    paid: false,
    churned: lastSeen > CHURNED_AFTER_DAYS,
  };
}

export interface DotPlotPerson {
  personId: string;
  signupDate: Date | null;
}

export interface DotPlotActivity {
  personId: string;
  timestamp: Date;
}

export function buildDotPlotUsers<T extends DotPlotPerson>(
  users: T[],
  activities: DotPlotActivity[]
): Array<T & DotPlotDerived> {
  const windowDates: Array<Date | null | undefined> = [];
  users.forEach((u) => windowDates.push(u.signupDate));
  activities.forEach((a) => windowDates.push(a.timestamp));

  const { baseDate, endDate, totalDays } = activityWindow(windowDates);

  const offsetsByPerson = new Map<string, number[]>();
  activities.forEach((record) => {
    if (record.timestamp < baseDate || record.timestamp > endDate) return;
    const day = dayOffset(record.timestamp, baseDate);
    const list = offsetsByPerson.get(record.personId);
    if (list) list.push(day);
    else offsetsByPerson.set(record.personId, [day]);
  });

  return users.map((user) => {
    const signupOffset = user.signupDate
      ? dayOffset(user.signupDate, baseDate)
      : 0;
    const activity = activityVector(
      offsetsByPerson.get(user.personId) ?? [],
      totalDays
    );
    return { ...user, ...deriveDotPlotFields(signupOffset, activity) };
  });
}
