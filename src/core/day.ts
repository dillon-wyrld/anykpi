/**
 * One shared day clock. Sidebar, wall mode, calendar birthday, and the
 * agent overview all read these functions. Do not copy the arithmetic.
 *
 * Day N, time-left-today, week number, and the next-milestone ladder are
 * civil-date math in the workspace home timezone — not elapsed UTC hours —
 * so DST, leap days, and half-hour offsets stay honest.
 */

import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export const DEFAULT_HOME_TIMEZONE = "UTC";

/** 100, 200, … 365, 500, 730, 1000, then every hundred. */
export const DAY_MILESTONE_LADDER = [
  100, 200, 300, 365, 500, 730, 1000,
] as const;

export function homeTimezoneConfigKey(workspaceId: string): string {
  return `home_timezone:${workspaceId}`;
}

export type CivilDate = {
  year: number;
  month: number;
  day: number;
};

export type TimeLeftToday = {
  ms: number;
  hours: number;
  minutes: number;
  label: string;
};

export type DayClock = {
  dayN: number;
  weekN: number;
  timeLeftMs: number;
  timeLeftHours: number;
  timeLeftMinutes: number;
  timeLeftLabel: string;
  nextMilestone: number;
  daysToNextMilestone: number;
  foundedAt: Date;
  timeZone: string;
};

export type DayClockFields = {
  dayN: number;
  weekN: number;
  timeLeftToday: string;
  nextMilestone: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function partNumber(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  return Number(parts.find((part) => part.type === type)?.value);
}

export function resolveHomeTimezone(value: string | null | undefined): string {
  if (!value) return DEFAULT_HOME_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return DEFAULT_HOME_TIMEZONE;
  }
}

export function civilDateInZone(instant: Date, timeZone: string): CivilDate {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  return {
    year: partNumber(parts, "year"),
    month: partNumber(parts, "month"),
    day: partNumber(parts, "day"),
  };
}

export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  return (
    a.year - b.year ||
    a.month - b.month ||
    a.day - b.day
  );
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function clampCivilDate(date: CivilDate): CivilDate {
  return {
    year: date.year,
    month: date.month,
    day: Math.min(date.day, daysInMonth(date.year, date.month)),
  };
}

export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

export function civilDaysBetween(from: CivilDate, to: CivilDate): number {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((end - start) / DAY_MS);
}

export function utcMidnightFromCivil(date: CivilDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

/** Offset of `timeZone` at `instant`: local = UTC + offset. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  let hour = partNumber(parts, "hour");
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(
    partNumber(parts, "year"),
    partNumber(parts, "month") - 1,
    partNumber(parts, "day"),
    hour,
    partNumber(parts, "minute"),
    partNumber(parts, "second")
  );
  const instantSec = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - instantSec;
}

export function zonedInstant(
  civil: CivilDate,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): Date {
  const utcGuess = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    hour,
    minute,
    second,
    millisecond
  );
  let offset = zoneOffsetMs(new Date(utcGuess), timeZone);
  let instant = utcGuess - offset;
  offset = zoneOffsetMs(new Date(instant), timeZone);
  instant = utcGuess - offset;
  return new Date(instant);
}

export function zonedMidnight(civil: CivilDate, timeZone: string): Date {
  return zonedInstant(civil, timeZone);
}

/**
 * Whole local days since founding. Founding day itself is Day 0.
 */
export function dayNumber(
  foundedAt: Date,
  now: Date,
  timeZone: string = DEFAULT_HOME_TIMEZONE
): number {
  const zone = resolveHomeTimezone(timeZone);
  return Math.max(
    0,
    civilDaysBetween(civilDateInZone(foundedAt, zone), civilDateInZone(now, zone))
  );
}

/** Week 1 is days 0–6. */
export function weekNumber(dayN: number): number {
  return Math.floor(Math.max(0, dayN) / 7) + 1;
}

export function timeLeftToday(
  now: Date,
  timeZone: string = DEFAULT_HOME_TIMEZONE
): TimeLeftToday {
  const zone = resolveHomeTimezone(timeZone);
  const tomorrow = addCivilDays(civilDateInZone(now, zone), 1);
  const ms = Math.max(0, zonedMidnight(tomorrow, zone).getTime() - now.getTime());
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  return {
    ms,
    hours,
    minutes,
    label: `${hours}h ${minutes}m`,
  };
}

export function nextMilestoneDay(dayN: number): number {
  const n = Math.max(0, dayN);
  for (const step of DAY_MILESTONE_LADDER) {
    if (step > n) return step;
  }
  return Math.ceil((n + 1) / 100) * 100;
}

/** True when `dayN` itself is on the ladder (Day 365, Day 1000, …). */
export function isDayMilestone(dayN: number): boolean {
  if (dayN <= 0) return false;
  return nextMilestoneDay(dayN - 1) === dayN;
}

/** Every earned ladder day up to and including `dayN`. */
export function earnedDayMilestones(dayN: number): number[] {
  const n = Math.max(0, dayN);
  const out: number[] = [];
  let cursor = 0;
  while (true) {
    const next = nextMilestoneDay(cursor);
    if (next > n) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/** Civil date of Day N in `timeZone`. Founding day is Day 0. */
export function civilDateOfDayN(
  foundedAt: Date,
  dayN: number,
  timeZone: string = DEFAULT_HOME_TIMEZONE
): CivilDate {
  const zone = resolveHomeTimezone(timeZone);
  return addCivilDays(civilDateInZone(foundedAt, zone), Math.max(0, dayN));
}

export function fallbackFoundedAt(
  configured: Date | null | undefined,
  signups: Array<Date | null | undefined>,
  now: Date
): Date {
  if (configured) return configured;
  let earliest: Date | undefined;
  for (const signup of signups) {
    if (!signup) continue;
    if (!earliest || signup.getTime() < earliest.getTime()) earliest = signup;
  }
  return earliest ?? now;
}

export function computeDayClock(input: {
  foundedAt: Date;
  now?: Date;
  timeZone?: string;
}): DayClock {
  const now = input.now ?? new Date();
  const timeZone = resolveHomeTimezone(input.timeZone);
  const dayN = dayNumber(input.foundedAt, now, timeZone);
  const left = timeLeftToday(now, timeZone);
  const next = nextMilestoneDay(dayN);
  return {
    dayN,
    weekN: weekNumber(dayN),
    timeLeftMs: left.ms,
    timeLeftHours: left.hours,
    timeLeftMinutes: left.minutes,
    timeLeftLabel: left.label,
    nextMilestone: next,
    daysToNextMilestone: next - dayN,
    foundedAt: input.foundedAt,
    timeZone,
  };
}

export function dayClockFields(clock: DayClock): DayClockFields {
  return {
    dayN: clock.dayN,
    weekN: clock.weekN,
    timeLeftToday: clock.timeLeftLabel,
    nextMilestone: clock.nextMilestone,
  };
}

/**
 * Latest earned founding anniversary on or before `asOf`, in `timeZone`.
 * Returns UTC midnight of that civil date so calendar identity stays stable.
 * Founding day itself is not an anniversary.
 */
export function anniversaryOnOrBefore(
  foundedAt: Date,
  asOf: Date,
  timeZone: string = DEFAULT_HOME_TIMEZONE
): Date | null {
  const zone = resolveHomeTimezone(timeZone);
  const founded = civilDateInZone(foundedAt, zone);
  const asOfDay = civilDateInZone(asOf, zone);
  if (compareCivilDates(asOfDay, founded) < 0) return null;

  let year = asOfDay.year;
  let anniversary = clampCivilDate({
    year,
    month: founded.month,
    day: founded.day,
  });
  if (compareCivilDates(anniversary, asOfDay) > 0) {
    year -= 1;
    anniversary = clampCivilDate({
      year,
      month: founded.month,
      day: founded.day,
    });
  }
  if (compareCivilDates(anniversary, founded) <= 0) return null;
  return utcMidnightFromCivil(anniversary);
}

export async function loadHomeTimezone(workspaceId: string): Promise<string> {
  const row = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.key, homeTimezoneConfigKey(workspaceId)))
    .get();
  return resolveHomeTimezone(row?.value);
}

export async function workspaceDayClock(
  workspaceId: string,
  options: {
    foundedAt?: Date | null;
    signupDates?: Array<Date | null | undefined>;
    now?: Date;
  } = {}
): Promise<DayClock> {
  const now = options.now ?? new Date();
  const timeZone = await loadHomeTimezone(workspaceId);
  return computeDayClock({
    foundedAt: fallbackFoundedAt(
      options.foundedAt,
      options.signupDates ?? [],
      now
    ),
    now,
    timeZone,
  });
}
