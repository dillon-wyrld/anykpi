/**
 * Read-only ICS calendar connector.
 *
 * One URL covers any host that serves a calendar feed. Polls on the
 * sync schedule, expands recurrences (including across DST), and writes
 * `cal_events`. Nothing is authored or written back.
 */

import { and, eq } from "drizzle-orm";
import type { SyncResult } from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertSyncState } from "@/core/upsert";
import { classifyCalendarDate, startOfLocalDay } from "@/core/views/calendar-math";
import { resolveCredentials } from "./credentials";
import { failedSync } from "./http-status";
import type { SyncOpts } from "./types";

export const ICS_SOURCE = "ics";
export const ICS_SOURCE_NAME = "Calendar";
export const ICS_SOURCE_COLOR = "#2563eb";
export const ICS_SOURCE_EMOJI = "📅";

const MAX_ICS_BYTES = 5_000_000;
const MAX_OCCURRENCES = 1000;
const LOOKBACK_MS = 180 * 86_400_000;
const LOOKAHEAD_MS = 540 * 86_400_000;

export type IcsDateTime = {
  date: Date;
  timeZone: string;
  allDay: boolean;
  floating: boolean;
};

export type ParsedIcsEvent = {
  uid: string;
  summary: string;
  start: IcsDateTime;
  rrule: string | null;
  status: string | null;
};

export type ExpandedIcsEvent = {
  uid: string;
  title: string;
  start: Date;
  timeZone: string;
  allDay: boolean;
  recurring: boolean;
};

type LocalYmd = { year: number; month: number; day: number };

function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - instant.getTime();
}

/** Instant whose wall clock in `timeZone` equals the given local parts. */
export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let offset = tzOffsetMs(new Date(wallAsUtc), timeZone);
  let instant = wallAsUtc - offset;
  offset = tzOffsetMs(new Date(instant), timeZone);
  instant = wallAsUtc - offset;
  return new Date(instant);
}

function addLocalDays(ymd: LocalYmd, days: number): LocalYmd {
  const utc = Date.UTC(ymd.year, ymd.month - 1, ymd.day + days);
  const next = new Date(utc);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function addLocalMonths(ymd: LocalYmd, months: number): LocalYmd {
  const total = ymd.month - 1 + months;
  const year = ymd.year + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { year, month: month + 1, day: Math.min(ymd.day, lastDay) };
}

export function normalizeIcsUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (/^webcals:/i.test(candidate)) {
    candidate = `https:${candidate.slice(candidate.indexOf(":") + 1)}`;
  } else if (/^webcal:/i.test(candidate)) {
    candidate = `https:${candidate.slice(candidate.indexOf(":") + 1)}`;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function icsUrlFromConfig(config?: Record<string, string>): string | null {
  const raw = config?.icsUrl || config?.url || config?.host;
  if (!raw) return null;
  return normalizeIcsUrl(raw);
}

function unfoldIcs(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseParams(meta: string): { name: string; params: Record<string, string> } {
  const pieces: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of meta) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (char === ";" && !quoted) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) pieces.push(current);

  const name = (pieces.shift() ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (const piece of pieces) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const key = piece.slice(0, eq).toUpperCase();
    let value = piece.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    params[key] = value;
  }
  return { name, params };
}

function parseIcsDateTime(value: string, params: Record<string, string>): IcsDateTime | null {
  const compact = value.trim();
  const tzid = params.TZID;
  const isDate = params.VALUE === "DATE" || /^\d{8}$/.test(compact);
  const match = compact.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? "0");
  const minute = Number(match[5] ?? "0");
  const second = Number(match[6] ?? "0");
  const utc = match[7] === "Z";

  if (isDate) {
    return {
      date: new Date(Date.UTC(year, month - 1, day)),
      timeZone: "UTC",
      allDay: true,
      floating: true,
    };
  }
  if (utc) {
    return {
      date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
      timeZone: "UTC",
      allDay: false,
      floating: false,
    };
  }
  if (tzid) {
    return {
      date: zonedLocalToUtc(tzid, year, month, day, hour, minute, second),
      timeZone: tzid,
      allDay: false,
      floating: false,
    };
  }
  return {
    date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
    timeZone: "UTC",
    allDay: false,
    floating: true,
  };
}

function weekdayIndex(token: string): number | null {
  const map: Record<string, number> = {
    SU: 0,
    MO: 1,
    TU: 2,
    WE: 3,
    TH: 4,
    FR: 5,
    SA: 6,
  };
  const key = token.replace(/^[+-]?\d+/, "").toUpperCase();
  return key in map ? map[key] : null;
}

function parseRrule(rrule: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const piece of rrule.split(";")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    parts[piece.slice(0, eq).toUpperCase()] = piece.slice(eq + 1);
  }
  return parts;
}

function localParts(start: IcsDateTime): {
  ymd: LocalYmd;
  hour: number;
  minute: number;
  second: number;
} {
  if (start.allDay || start.timeZone === "UTC" || start.floating) {
    return {
      ymd: {
        year: start.date.getUTCFullYear(),
        month: start.date.getUTCMonth() + 1,
        day: start.date.getUTCDate(),
      },
      hour: start.date.getUTCHours(),
      minute: start.date.getUTCMinutes(),
      second: start.date.getUTCSeconds(),
    };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: start.timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(start.date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    ymd: {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
    },
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function instantFromLocal(
  start: IcsDateTime,
  ymd: LocalYmd,
  hour: number,
  minute: number,
  second: number
): Date {
  if (start.allDay) {
    return new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  }
  if (start.timeZone === "UTC" || start.floating) {
    return new Date(
      Date.UTC(ymd.year, ymd.month - 1, ymd.day, hour, minute, second)
    );
  }
  return zonedLocalToUtc(
    start.timeZone,
    ymd.year,
    ymd.month,
    ymd.day,
    hour,
    minute,
    second
  );
}

function weekdayOfYmd(ymd: LocalYmd): number {
  return new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day)).getUTCDay();
}

/**
 * Expand a VEVENT into occurrence instants. Weekly (and other) series
 * increment on the local calendar so wall-clock time is preserved across DST.
 */
export function expandOccurrences(
  event: ParsedIcsEvent,
  now: Date = new Date()
): Date[] {
  const windowStart = new Date(now.getTime() - LOOKBACK_MS);
  const windowEnd = new Date(now.getTime() + LOOKAHEAD_MS);
  if (!event.rrule) {
    return [event.start.date];
  }

  const rule = parseRrule(event.rrule);
  const freq = (rule.FREQ ?? "").toUpperCase();
  const interval = Math.max(1, Number(rule.INTERVAL ?? "1") || 1);
  const count = rule.COUNT ? Math.max(1, Number(rule.COUNT) || 0) : null;
  let until: Date | null = null;
  if (rule.UNTIL) {
    until = parseIcsDateTime(rule.UNTIL, rule.UNTIL.endsWith("Z") ? {} : {})?.date ?? null;
  }
  const byDays = (rule.BYDAY ?? "")
    .split(",")
    .map((token) => weekdayIndex(token.trim()))
    .filter((day): day is number => day !== null);

  const { ymd: startYmd, hour, minute, second } = localParts(event.start);
  const occurrences: Date[] = [];
  const bounded = Boolean(count || until);
  const scanEnd = until && until < windowEnd ? until : windowEnd;
  const safetyEnd = new Date(event.start.date.getTime() + 20 * 365 * 86_400_000);

  const pushIf = (instant: Date) => {
    if (until && instant > until) return false;
    if (!bounded && instant < windowStart) return true;
    if (instant > scanEnd && !bounded) return false;
    if (instant > safetyEnd) return false;
    if (bounded && instant < windowStart) {
      occurrences.push(instant);
      return true;
    }
    if (instant >= windowStart && instant <= windowEnd) {
      occurrences.push(instant);
    } else if (bounded && instant <= windowEnd) {
      occurrences.push(instant);
    }
    return occurrences.length < MAX_OCCURRENCES;
  };

  if (freq === "WEEKLY" && byDays.length > 0) {
    let weekStart = startYmd;
    const startWeekday = weekdayOfYmd(startYmd);
    weekStart = addLocalDays(weekStart, -startWeekday);
    let week = 0;
    while (occurrences.length < MAX_OCCURRENCES) {
      if (week % interval === 0) {
        const days = [...byDays].sort((a, b) => a - b);
        for (const day of days) {
          const ymd = addLocalDays(weekStart, day);
          const instant = instantFromLocal(event.start, ymd, hour, minute, second);
          if (instant < event.start.date) continue;
          if (count && occurrences.length >= count) return occurrences.slice(0, count);
          if (!pushIf(instant)) {
            return occurrences.slice(0, MAX_OCCURRENCES);
          }
          if (until && instant > until) return occurrences;
        }
      }
      week += 1;
      weekStart = addLocalDays(weekStart, 7);
      const probe = instantFromLocal(event.start, weekStart, hour, minute, second);
      if (!bounded && probe > windowEnd) break;
      if (probe > safetyEnd) break;
      if (count && occurrences.length >= count) break;
    }
    return count ? occurrences.slice(0, count) : occurrences;
  }

  let cursor = startYmd;
  let n = 0;
  while (occurrences.length < MAX_OCCURRENCES) {
    if (n % interval === 0) {
      const instant = instantFromLocal(event.start, cursor, hour, minute, second);
      if (count && occurrences.length >= count) break;
      if (!pushIf(instant)) break;
      if (until && instant > until) break;
    }
    n += 1;
    if (freq === "DAILY") {
      cursor = addLocalDays(cursor, 1);
    } else if (freq === "WEEKLY") {
      cursor = addLocalDays(cursor, 7);
    } else if (freq === "MONTHLY") {
      cursor = addLocalMonths(cursor, 1);
    } else if (freq === "YEARLY") {
      cursor = addLocalMonths(cursor, 12);
    } else {
      break;
    }
    const probe = instantFromLocal(event.start, cursor, hour, minute, second);
    if (!bounded && probe > windowEnd) break;
    if (probe > safetyEnd) break;
    if (count && n > count * interval + interval) break;
  }
  return count ? occurrences.slice(0, count) : occurrences;
}

export function parseIcsCalendar(text: string): ParsedIcsEvent[] {
  const unfolded = unfoldIcs(text);
  if (!/BEGIN:VCALENDAR/i.test(unfolded)) {
    throw new Error("not an ICS calendar");
  }

  const events: ParsedIcsEvent[] = [];
  let inEvent = false;
  let uid = "";
  let summary = "";
  let start: IcsDateTime | null = null;
  let rrule: string | null = null;
  let status: string | null = null;

  const reset = () => {
    inEvent = false;
    uid = "";
    summary = "";
    start = null;
    rrule = null;
    status = null;
  };

  for (const rawLine of unfolded.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const { name, params } = parseParams(line.slice(0, colon));
    const value = line.slice(colon + 1);

    if (name === "BEGIN" && value.toUpperCase() === "VEVENT") {
      reset();
      inEvent = true;
      continue;
    }
    if (name === "END" && value.toUpperCase() === "VEVENT") {
      if (inEvent && start && status !== "CANCELLED") {
        events.push({
          uid: uid || `ics-${events.length + 1}`,
          summary: summary || "(no title)",
          start,
          rrule,
          status,
        });
      }
      reset();
      continue;
    }
    if (!inEvent) continue;
    if (name === "UID") uid = unescapeIcsText(value);
    if (name === "SUMMARY") summary = unescapeIcsText(value);
    if (name === "STATUS") status = value.trim().toUpperCase();
    if (name === "RRULE") rrule = value.trim();
    if (name === "DTSTART") start = parseIcsDateTime(value, params);
  }

  return events;
}

export function expandCalendar(
  text: string,
  now: Date = new Date()
): ExpandedIcsEvent[] {
  const expanded: ExpandedIcsEvent[] = [];
  for (const event of parseIcsCalendar(text)) {
    const dates = expandOccurrences(event, now);
    const recurring = Boolean(event.rrule);
    for (const start of dates) {
      expanded.push({
        uid: event.uid,
        title: event.summary,
        start,
        timeZone: event.start.timeZone,
        allDay: event.start.allDay,
        recurring,
      });
    }
  }
  expanded.sort((a, b) => a.start.getTime() - b.start.getTime());
  return expanded;
}

function formatBadge(event: ExpandedIcsEvent): string {
  if (event.allDay) return "all day";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: event.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(event.start);
}

async function persistEvents(
  workspaceId: string,
  events: ExpandedIcsEvent[],
  now: Date
): Promise<number> {
  // Replace only this source. Milestone rows (ANY-21, source=anykpi)
  // and other calendar sources stay put.
  await db
    .delete(schema.calEvents)
    .where(
      and(
        eq(schema.calEvents.workspaceId, workspaceId),
        eq(schema.calEvents.source, ICS_SOURCE)
      )
    );

  const today = startOfLocalDay(now);
  for (const event of events) {
    const classified = classifyCalendarDate(event.start, today);
    await db.insert(schema.calEvents).values({
      source: ICS_SOURCE,
      sourceName: ICS_SOURCE_NAME,
      sourceColor: ICS_SOURCE_COLOR,
      type: event.recurring ? "ritual" : "comms",
      emoji: ICS_SOURCE_EMOJI,
      title: event.title,
      badge: formatBadge(event),
      eventDate: event.start,
      isFuture: classified.isFuture,
      workspaceId,
    });
  }
  return events.length;
}

export async function syncIcs(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials(ICS_SOURCE, opts?.config);
  const icsUrl = icsUrlFromConfig(credentials);

  if (!icsUrl) {
    throw new Error("ICS URL is required");
  }

  let rowsSynced = 0;
  try {
    const response = await fetch(icsUrl, {
      method: "GET",
      credentials: "omit",
      headers: {
        Accept: "text/calendar, text/plain, */*",
        "User-Agent": "anykpi-ics/0.1",
      },
    });

    if (!response.ok) {
      return failedSync({
        source: ICS_SOURCE,
        sourceName: ICS_SOURCE_NAME,
        workspaceId,
        status: response.status,
        rowsSynced,
      });
    }

    const text = await response.text();
    if (text.length > MAX_ICS_BYTES) {
      await upsertSyncState({
        source: ICS_SOURCE,
        sourceName: ICS_SOURCE_NAME,
        lastSync: new Date(),
        status: "error",
        error: "sync failed",
        workspaceId,
      });
      return {
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "sync failed",
      };
    }

    const now = new Date();
    const events = expandCalendar(text, now);
    rowsSynced = await persistEvents(workspaceId, events, now);

    await upsertSyncState({
      source: ICS_SOURCE,
      sourceName: ICS_SOURCE_NAME,
      lastSync: now,
      status: "success",
      workspaceId,
    });

    return { rowsSynced, nextCursor: null, health: "ok" };
  } catch {
    await upsertSyncState({
      source: ICS_SOURCE,
      sourceName: ICS_SOURCE_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });
    throw new Error("sync failed");
  }
}
