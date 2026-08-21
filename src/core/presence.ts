/**
 * Presence read model — who is online, by city, honestly.
 *
 * Online means real activity in the trailing hour as of the last data,
 * never a simulated wake/sleep hour. Past-hour deltas ask the same
 * question at T−1h. Cities are summaries only; no response lists a
 * person's online state.
 */

import { and, desc, eq, gt, lte } from "drizzle-orm";
import { loadCompanyProfile, type HomeCity } from "@/core/company-profile";
import {
  PresenceSchema,
  type Presence,
  type PresenceCity,
} from "@/core/contracts";
import { db } from "@/core/db";
import { HOUR_MS } from "@/core/day";
import { cityForGeography, resolveGeography } from "@/core/geography";
import * as schema from "@/core/schema";

export type PresenceUser = {
  personId: string;
  country?: string | null;
  timezone?: string | null;
};

export type PresenceEvent = {
  personId: string;
  timestamp: Date;
};

type CityKey = string;

type CityBucket = {
  city: string;
  country: string;
  timezone: string;
  users: number;
  now: number;
  cameOnline: number;
  droppedOff: number;
};

function eventMs(timestamp: Date): number {
  return timestamp.getTime();
}

function cityKey(city: string, country: string, timezone: string): CityKey {
  return `${country}:${city}:${timezone}`;
}

function inTrailingHour(timestamp: Date, at: Date): boolean {
  const t = eventMs(timestamp);
  const end = at.getTime();
  const start = end - HOUR_MS;
  return t > start && t <= end;
}

function onlinePersonIds(events: PresenceEvent[], at: Date): Set<string> {
  const ids = new Set<string>();
  for (const event of events) {
    if (inTrailingHour(event.timestamp, at)) ids.add(event.personId);
  }
  return ids;
}

function emptyBucket(
  city: string,
  country: string,
  timezone: string
): CityBucket {
  return {
    city,
    country,
    timezone,
    users: 0,
    now: 0,
    cameOnline: 0,
    droppedOff: 0,
  };
}

function matchesHome(bucket: CityBucket, home: HomeCity): boolean {
  return bucket.timezone === home.timezone || bucket.city === home.label;
}

function sortCities(cities: PresenceCity[]): PresenceCity[] {
  return [...cities].sort((a, b) => {
    if (a.home !== b.home) return a.home ? -1 : 1;
    if (b.users !== a.users) return b.users - a.users;
    return a.city.localeCompare(b.city) || a.timezone.localeCompare(b.timezone);
  });
}

function toCityRow(bucket: CityBucket, home: boolean): PresenceCity {
  return {
    city: bucket.city,
    country: bucket.country,
    timezone: bucket.timezone,
    users: bucket.users,
    online: bucket.now,
    cameOnline: bucket.cameOnline,
    droppedOff: bucket.droppedOff,
    home,
  };
}

/**
 * Pure tally. `asOf` is T — the last data, not wall-clock "now".
 * When `asOf` is missing there is no honest T, so every online count is 0.
 */
export function computePresence(input: {
  users: PresenceUser[];
  activity: PresenceEvent[];
  asOf: Date | null;
  homeCity?: HomeCity | null;
}): Presence {
  const home = input.homeCity ?? null;
  const asOf = input.asOf;
  const prevAt = asOf ? new Date(asOf.getTime() - HOUR_MS) : null;
  const onlineNow = asOf ? onlinePersonIds(input.activity, asOf) : new Set<string>();
  const onlinePrev = prevAt
    ? onlinePersonIds(input.activity, prevAt)
    : new Set<string>();

  const buckets = new Map<CityKey, CityBucket>();
  let unplaced = 0;
  let unplacedOnline = 0;
  let unplacedCameOnline = 0;
  let unplacedDroppedOff = 0;

  for (const user of input.users) {
    const now = onlineNow.has(user.personId);
    const prev = onlinePrev.has(user.personId);
    const came = now && !prev;
    const dropped = !now && prev;

    const city = cityForGeography(
      resolveGeography({ country: user.country, timezone: user.timezone })
    );
    if (!city) {
      unplaced += 1;
      if (now) unplacedOnline += 1;
      if (came) unplacedCameOnline += 1;
      if (dropped) unplacedDroppedOff += 1;
      continue;
    }

    const key = cityKey(city.city, city.country, city.timezone);
    const bucket = buckets.get(key) ?? emptyBucket(city.city, city.country, city.timezone);
    bucket.users += 1;
    if (now) bucket.now += 1;
    if (came) bucket.cameOnline += 1;
    if (dropped) bucket.droppedOff += 1;
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()];
  let homeFound = false;
  const cities: PresenceCity[] = rows.map((bucket) => {
    const isHome = home ? matchesHome(bucket, home) : false;
    if (isHome) homeFound = true;
    return toCityRow(bucket, isHome);
  });

  if (home && !homeFound) {
    const placed = cityForGeography(resolveGeography({ timezone: home.timezone }));
    cities.push(
      toCityRow(
        emptyBucket(home.label, placed?.country ?? "", home.timezone),
        true
      )
    );
  }

  const placedOnline = cities.reduce((sum, row) => sum + row.online, 0);
  const placedCame = cities.reduce((sum, row) => sum + row.cameOnline, 0);
  const placedDropped = cities.reduce((sum, row) => sum + row.droppedOff, 0);

  return PresenceSchema.parse({
    asOf: asOf ? asOf.toISOString() : null,
    online: placedOnline + unplacedOnline,
    cameOnline: placedCame + unplacedCameOnline,
    droppedOff: placedDropped + unplacedDroppedOff,
    unplaced,
    unplacedOnline,
    cities: sortCities(cities),
  });
}

async function lastDataAsOf(workspaceId: string): Promise<Date | null> {
  const latest = await db
    .select({
      id: schema.activity.id,
      timestamp: schema.activity.timestamp,
    })
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .orderBy(desc(schema.activity.id))
    .limit(1)
    .get();
  return latest?.timestamp ?? null;
}

export async function loadWorkspacePresence(
  workspaceId: string,
  options: { asOf?: Date | null } = {}
): Promise<Presence> {
  const asOf =
    options.asOf !== undefined ? options.asOf : await lastDataAsOf(workspaceId);

  const users = await db
    .select({
      personId: schema.users.personId,
      country: schema.users.country,
      timezone: schema.users.timezone,
    })
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspaceId))
    .all();

  let activity: PresenceEvent[] = [];
  if (asOf) {
    const windowStart = new Date(asOf.getTime() - 2 * HOUR_MS);
    const rows = await db
      .select({
        personId: schema.activity.personId,
        timestamp: schema.activity.timestamp,
      })
      .from(schema.activity)
      .where(
        and(
          eq(schema.activity.workspaceId, workspaceId),
          gt(schema.activity.timestamp, windowStart),
          lte(schema.activity.timestamp, asOf)
        )
      )
      .all();
    activity = rows.map((row) => ({
      personId: row.personId,
      timestamp: row.timestamp,
    }));
  }

  const profile = await loadCompanyProfile(workspaceId);
  return computePresence({
    users,
    activity,
    asOf,
    homeCity: profile.homeCity,
  });
}
