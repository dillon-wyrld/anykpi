/**
 * Day-of-YourCo snapshot math. The sidebar paints this object; day number
 * and time-left come from src/core/day.ts, tallies from overview.presence.
 * A workspace with no synced data (and the demo workspace) runs on the
 * demo cast so the module stays complete, labeled demo.
 */

import { formatCompanyDayLabel } from "@/core/company-day";
import type {
  CompanyProfile,
  OverviewResponse,
  Presence,
  PresenceCity,
} from "@/core/contracts";

const HOUR_MS = 3_600_000;
const DEFAULT_HOME_TIMEZONE = "UTC";

function resolveHomeTimezone(value: string | null | undefined): string {
  if (!value) return DEFAULT_HOME_TIMEZONE;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return DEFAULT_HOME_TIMEZONE;
  }
}

export const DAY_TRACKER_TICK_MS = 60_000;
export const DEFAULT_SHOWN = 3;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const SHORT_CITY: Record<string, string> = {
  "San Francisco": "SF",
  "New York": "NYC",
  "Los Angeles": "LA",
  "São Paulo": "São Paulo",
};

export type DemoCastCity = {
  city: string;
  short: string;
  country: string;
  timezone: string;
  users: number;
  home?: boolean;
};

/** Prototype TZONE list, ranked like the seeded cast. Home is SF. */
export const DEMO_CAST_CITIES: DemoCastCity[] = [
  {
    city: "San Francisco",
    short: "SF",
    country: "US",
    timezone: "America/Los_Angeles",
    users: 58,
    home: true,
  },
  {
    city: "Toronto",
    short: "Toronto",
    country: "CA",
    timezone: "America/Toronto",
    users: 22,
  },
  {
    city: "London",
    short: "London",
    country: "GB",
    timezone: "Europe/London",
    users: 18,
  },
  {
    city: "Paris",
    short: "Paris",
    country: "FR",
    timezone: "Europe/Paris",
    users: 14,
  },
  {
    city: "Berlin",
    short: "Berlin",
    country: "DE",
    timezone: "Europe/Berlin",
    users: 12,
  },
  {
    city: "São Paulo",
    short: "São Paulo",
    country: "BR",
    timezone: "America/Sao_Paulo",
    users: 10,
  },
  {
    city: "Bangalore",
    short: "Bangalore",
    country: "IN",
    timezone: "Asia/Kolkata",
    users: 9,
  },
  {
    city: "Tokyo",
    short: "Tokyo",
    country: "JP",
    timezone: "Asia/Tokyo",
    users: 8,
  },
];

export type DayTrackerCity = {
  key: string;
  city: string;
  short: string;
  country: string;
  timezone: string;
  flag: string;
  users: number;
  online: number;
  cameOnline: number;
  droppedOff: number;
  home: boolean;
  localHour: number;
  clock: string;
  night: boolean;
  asleep: boolean;
  needle: number;
  anchor: "" | "l" | "r";
};

export type DayTrackerStat = {
  label: string;
  value: string;
  pct: number;
};

export type DayTrackerSnapshot = {
  dayLabel: string;
  dayN: number;
  timeLeftLabel: string;
  foundedLine: string | null;
  stats: DayTrackerStat[];
  cities: DayTrackerCity[];
  shownKeys: string[];
  availableKeys: string[];
  demo: boolean;
  freshnessLabel: string | null;
  signature: string;
};

export type DayTrackerProfile = Pick<
  CompanyProfile,
  "companyName" | "dayLabel" | "foundedAt" | "homeCity"
>;

export function cityKey(city: string, country: string, timezone: string): string {
  return `${country}:${city}:${timezone}`;
}

export function flagEmoji(country: string): string {
  const code = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)
  );
}

export function shortCityName(city: string): string {
  return SHORT_CITY[city] ?? city;
}

function partNumber(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  return Number(parts.find((part) => part.type === type)?.value);
}

export function localHourInZone(now: Date, timeZone: string): number {
  const zone = resolveHomeTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  let hour = partNumber(parts, "hour");
  if (hour === 24) hour = 0;
  return hour + partNumber(parts, "minute") / 60 + partNumber(parts, "second") / 3600;
}

export function formatLocalClock(hour: number): string {
  const hh = Math.floor(hour);
  const mm = Math.floor((hour - hh) * 60);
  const ap = hh < 12 ? "am" : "pm";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ap}`;
}

/** Night grey at both ends: before 6:30a or after 9:30p. */
export function isNightHour(hour: number): boolean {
  return hour < 6.5 || hour >= 21.5;
}

/**
 * Needle x in the midnight→midnight bar. Clamped so the 1.5px mark
 * still renders at 11:59pm. Label flips its anchor near the ends.
 */
export function needlePlacement(hour: number): {
  x: number;
  anchor: "" | "l" | "r";
} {
  const x = Math.min(99.4, Math.max(0.6, (hour / 24) * 100));
  const anchor = x > 78 ? "r" : x < 22 ? "l" : "";
  return { x, anchor };
}

export function zoneOffsetHours(now: Date, timeZone: string): number {
  const zone = resolveHomeTimezone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
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
  const instantSec = Math.floor(now.getTime() / 1000) * 1000;
  return (asUtc - instantSec) / HOUR_MS;
}

export function formatFoundedLine(
  foundedAt: Date,
  timeZone: string
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: resolveHomeTimezone(timeZone),
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(foundedAt);
  const day = parts.find((part) => part.type === "day")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const year = parts.find((part) => part.type === "year")?.value;
  const monthIdx = MONTHS.findIndex((name) => name === month);
  const mon = monthIdx >= 0 ? MONTHS[monthIdx] : month;
  return `Founded ${day} ${mon} ${year}`;
}

export function formatFreshnessChip(asOf: string | null, now: Date): string | null {
  if (!asOf) return null;
  const then = new Date(asOf);
  if (Number.isNaN(then.getTime())) return null;
  const delta = Math.max(0, now.getTime() - then.getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function hasSyncedPresence(
  overview: Pick<OverviewResponse, "totalUsers" | "presence"> | null
): boolean {
  if (!overview) return false;
  return overview.totalUsers > 0 || overview.presence.asOf != null;
}

export function shouldUseDemoCast(
  workspace: string,
  overview: Pick<OverviewResponse, "totalUsers" | "presence"> | null
): boolean {
  return workspace === "demo" || !hasSyncedPresence(overview);
}

function uSeed(id: string): number {
  let h = 9;
  for (const ch of id) {
    h = Math.imul(h ^ ch.charCodeAt(0), 387420489) >>> 0;
  }
  return h;
}

function demoWakeSleep(id: string): { wake: number; sleep: number } {
  const h = uSeed(id);
  return { wake: 6 + (h % 8) / 2, sleep: 21.5 + ((h >>> 3) % 9) / 2 };
}

function demoUserOnline(id: string, hour: number): boolean {
  const w = demoWakeSleep(id);
  const hh = hour < w.wake ? hour + 24 : hour;
  return hh >= w.wake && hh < w.sleep;
}

function demoCityTallies(
  city: DemoCastCity,
  now: Date
): { online: number; cameOnline: number; droppedOff: number } {
  const hour = localHourInZone(now, city.timezone);
  const prev = localHourInZone(new Date(now.getTime() - HOUR_MS), city.timezone);
  let online = 0;
  let cameOnline = 0;
  let droppedOff = 0;
  for (let i = 0; i < city.users; i += 1) {
    const id = `${city.country}:${city.city}:${i}`;
    const on = demoUserOnline(id, hour);
    const was = demoUserOnline(id, prev);
    if (on) online += 1;
    if (on && !was) cameOnline += 1;
    if (!on && was) droppedOff += 1;
  }
  return { online, cameOnline, droppedOff };
}

function decorateCity(
  input: {
    city: string;
    country: string;
    timezone: string;
    users: number;
    online: number;
    cameOnline: number;
    droppedOff: number;
    home: boolean;
    short?: string;
  },
  now: Date
): DayTrackerCity {
  const hour = localHourInZone(now, input.timezone);
  const { x, anchor } = needlePlacement(hour);
  const users = Math.max(0, input.users);
  return {
    key: cityKey(input.city, input.country, input.timezone),
    city: input.city,
    short: input.short ?? shortCityName(input.city),
    country: input.country,
    timezone: input.timezone,
    flag: flagEmoji(input.country),
    users,
    online: input.online,
    cameOnline: input.cameOnline,
    droppedOff: input.droppedOff,
    home: input.home,
    localHour: hour,
    clock: formatLocalClock(hour),
    night: isNightHour(hour),
    asleep: users > 0 ? input.online / users < 0.25 : true,
    needle: x,
    anchor,
  };
}

export function demoCastCities(
  now: Date,
  homeCity?: { timezone: string; label: string } | null
): DayTrackerCity[] {
  return DEMO_CAST_CITIES.map((row) => {
    const tallies = demoCityTallies(row, now);
    const home =
      row.home === true ||
      (homeCity != null &&
        (row.timezone === homeCity.timezone || row.city === homeCity.label));
    return decorateCity({ ...row, ...tallies, home }, now);
  }).sort((a, b) => {
    if (a.home !== b.home) return a.home ? -1 : 1;
    if (b.users !== a.users) return b.users - a.users;
    return a.city.localeCompare(b.city);
  });
}

export function presenceCities(presence: Presence, now: Date): DayTrackerCity[] {
  return presence.cities.map((row: PresenceCity) =>
    decorateCity(
      {
        city: row.city,
        country: row.country,
        timezone: row.timezone,
        users: row.users,
        online: row.online,
        cameOnline: row.cameOnline,
        droppedOff: row.droppedOff,
        home: row.home,
      },
      now
    )
  );
}

export function defaultShownKeys(cities: DayTrackerCity[]): string[] {
  if (cities.length === 0) return [];
  const home = cities.find((row) => row.home) ?? cities[0];
  const rest = cities.filter((row) => row.key !== home.key);
  return [home, ...rest].slice(0, DEFAULT_SHOWN).map((row) => row.key);
}

function clampShownKeys(
  requested: string[] | undefined,
  cities: DayTrackerCity[]
): string[] {
  const available = new Set(cities.map((row) => row.key));
  const kept = (requested ?? []).filter((key) => available.has(key));
  if (kept.length > 0) return kept;
  return defaultShownKeys(cities);
}

export function railPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Warm = high sits at the top of the 30px rail. */
export function railMarkerPercent(pct: number): number {
  return 100 - railPercent(pct);
}

export function formatSpreadHours(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  return `${rounded} hrs`;
}

export function homeTimezoneOf(profile: DayTrackerProfile | null): string {
  return resolveHomeTimezone(profile?.homeCity?.timezone ?? DEFAULT_HOME_TIMEZONE);
}

export type DayTrackerClock = {
  dayN: number;
  weekN: number;
  timeLeftLabel: string;
  nextMilestone: number;
  daysToNextMilestone: number;
};

/**
 * Clock fields the sidebar paints. Arithmetic lives in src/core/day.ts
 * (overview already ran it). A mocked overview is how tests freeze `now`.
 */
export function clockFromOverview(
  overview: Pick<OverviewResponse, "dayN" | "weekN" | "timeLeftToday" | "nextMilestone"> | null,
  fallback: DayTrackerClock = {
    dayN: 0,
    weekN: 1,
    timeLeftLabel: "0h 0m",
    nextMilestone: 100,
    daysToNextMilestone: 100,
  }
): DayTrackerClock {
  if (!overview) return fallback;
  return {
    dayN: overview.dayN,
    weekN: overview.weekN,
    timeLeftLabel: overview.timeLeftToday,
    nextMilestone: overview.nextMilestone,
    daysToNextMilestone: overview.nextMilestone - overview.dayN,
  };
}

export function dayTrackerSignature(input: {
  dayN: number;
  timeLeftLabel: string;
  demo: boolean;
  online: number;
  shown: Array<Pick<DayTrackerCity, "key" | "online" | "cameOnline" | "droppedOff">>;
  freshnessLabel: string | null;
}): string {
  return [
    input.dayN,
    input.timeLeftLabel,
    input.demo ? "demo" : "live",
    input.online,
    input.freshnessLabel ?? "",
    input.shown
      .map((row) => `${row.key}${row.online}${row.cameOnline}${row.droppedOff}`)
      .join(),
  ].join("|");
}

export function buildDayTrackerSnapshot(input: {
  workspace: string;
  profile: DayTrackerProfile | null;
  overview: OverviewResponse | null;
  now: Date;
  shownKeys?: string[];
}): DayTrackerSnapshot {
  const demo = shouldUseDemoCast(input.workspace, input.overview);
  const clock = clockFromOverview(input.overview);
  const cities = demo
    ? demoCastCities(input.now, input.profile?.homeCity)
    : input.overview
      ? presenceCities(input.overview.presence, input.now)
      : [];
  const shownKeys = clampShownKeys(input.shownKeys, cities);
  const shown = shownKeys
    .map((key) => cities.find((row) => row.key === key))
    .filter((row): row is DayTrackerCity => row != null);
  const online = demo
    ? cities.reduce((sum, row) => sum + row.online, 0)
    : (input.overview?.presence.online ?? 0);
  const totalUsers = demo
    ? cities.reduce((sum, row) => sum + row.users, 0)
    : Math.max(1, input.overview?.totalUsers ?? 0);
  const offs = shown.map((row) => zoneOffsetHours(input.now, row.timezone));
  const spread = offs.length > 0 ? Math.max(...offs) - Math.min(...offs) : 0;
  const next = clock.nextMilestone;
  const toGo = clock.daysToNextMilestone;
  const dayN = clock.dayN;
  const timeLeftLabel = clock.timeLeftLabel;
  const freshnessLabel = demo
    ? null
    : formatFreshnessChip(input.overview?.presence.asOf ?? null, input.now);
  const foundedLine = input.profile?.foundedAt
    ? formatFoundedLine(new Date(input.profile.foundedAt), homeTimezoneOf(input.profile))
    : null;
  const dayLabel =
    input.profile?.dayLabel ?? formatCompanyDayLabel(input.profile?.companyName);

  const stats: DayTrackerStat[] = [
    {
      label: "Week",
      value: String(clock.weekN),
      pct: railPercent(((dayN % 365) / 365) * 100),
    },
    {
      label: "Online",
      value: String(online),
      pct: railPercent((online / totalUsers) * 100),
    },
    {
      label: "Next up",
      value: `Day ${next}`,
      pct: railPercent((1 - toGo / next) * 100),
    },
    {
      label: "Spread",
      value: formatSpreadHours(spread),
      pct: railPercent((spread / 24) * 100),
    },
  ];

  return {
    dayLabel,
    dayN,
    timeLeftLabel,
    foundedLine,
    stats,
    cities,
    shownKeys,
    availableKeys: cities.map((row) => row.key),
    demo,
    freshnessLabel,
    signature: dayTrackerSignature({
      dayN,
      timeLeftLabel,
      demo,
      online,
      shown,
      freshnessLabel,
    }),
  };
}
