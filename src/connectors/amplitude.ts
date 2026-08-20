import type { SyncResult } from "@/core/contracts";
import { upsertSyncState } from "@/core/upsert";
import {
  activityExternalId,
  classifyEvent,
  insertActivitiesIdempotent,
  insertUserIfAbsent,
  type ActivityWrite,
} from "./activity";
import { resolveCredentials } from "./credentials";
import {
  encodeSourceCursor,
  laterIso,
  loadSyncCursor,
  parseSourceCursor,
  saveSyncCursor,
  type SourceCursor,
} from "./cursor";
import { failedSync } from "./http-status";
import type { SyncOpts } from "./types";

export const AMPLITUDE_SOURCE = "amplitude";
export const AMPLITUDE_NAME = "Amplitude";
export const AMPLITUDE_USER_LIMIT = 1000;
export const AMPLITUDE_EXPORT_LIMIT = 10000;
const MAX_PAGES = 10_000;

type AmplitudeUser = {
  user_id?: string;
  amplitude_id?: string | number;
  platform?: string;
  country?: string;
  user_properties?: {
    name?: string;
    email?: string;
    emoji?: string;
    created_at?: string;
  };
};

type AmplitudeEvent = {
  user_id?: string;
  amplitude_id?: string | number;
  event_type?: string;
  event_time?: string;
  platform?: string;
  uuid?: string;
  $insert_id?: string;
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

async function persistCursor(workspaceId: string, cursor: SourceCursor): Promise<string> {
  const encoded = encodeSourceCursor(cursor);
  await saveSyncCursor(workspaceId, AMPLITUDE_SOURCE, encoded);
  return encoded;
}

function parseExportLines(text: string): AmplitudeEvent[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AmplitudeEvent);
}

export async function syncAmplitude(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials("amplitude", opts?.config);
  const apiKey = credentials.apiKey;
  const secretKey = credentials.secretKey;

  if (!apiKey || !secretKey) {
    throw new Error("Amplitude API key and secret key are required");
  }

  const auth = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
  const headers = {
    Authorization: `Basic ${auth}`,
    "Content-Type": "application/json",
  };

  let rowsSynced = 0;
  let cursor = parseSourceCursor(
    opts?.cursor ?? (await loadSyncCursor(workspaceId, AMPLITUDE_SOURCE))
  );
  let since = cursor.since ?? null;

  try {
    if (cursor.phase === "persons") {
      let pageToken = cursor.page ?? "0";
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const offset = Number(pageToken) || 0;
        const usersResponse = await fetch("https://amplitude.com/api/2/usersearch", {
          method: "POST",
          headers,
          body: JSON.stringify({
            user_search: {
              limit: AMPLITUDE_USER_LIMIT,
              offset,
            },
          }),
        });
        if (!usersResponse.ok) {
          return failedSync({
            source: AMPLITUDE_SOURCE,
            sourceName: AMPLITUDE_NAME,
            workspaceId,
            status: usersResponse.status,
            rowsSynced,
          });
        }
        const usersData = (await usersResponse.json()) as {
          data?: AmplitudeUser[];
          next?: string | null;
          cursor?: string | null;
        };
        const results = usersData.data || [];
        for (const user of results) {
          const distinctId = user.user_id || user.amplitude_id;
          if (distinctId == null) continue;
          rowsSynced += await insertUserIfAbsent({
            personId: `person_${distinctId}`,
            name: user.user_properties?.name || String(distinctId),
            email: user.user_properties?.email || null,
            emoji: user.user_properties?.emoji || null,
            platform: user.platform || null,
            country: user.country || null,
            signupDate: user.user_properties?.created_at
              ? new Date(user.user_properties.created_at)
              : new Date(),
            workspaceId,
          });
        }
        const next =
          usersData.next ??
          usersData.cursor ??
          (results.length >= AMPLITUDE_USER_LIMIT ? String(offset + AMPLITUDE_USER_LIMIT) : null);
        if (next) {
          pageToken = next;
          await persistCursor(workspaceId, {
            v: 1,
            phase: "persons",
            page: next,
            since,
          });
        } else {
          break;
        }
      }
      cursor = { v: 1, phase: "events", since };
      await persistCursor(workspaceId, cursor);
    }

    if (cursor.phase === "events" || cursor.phase === "caught_up") {
      const endDate = isoDate(new Date());
      const startDate = isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      let start =
        cursor.phase === "events" && cursor.page
          ? cursor.page
          : cursor.phase === "caught_up" && since
            ? since
            : startDate;

      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const eventsResponse = await fetch(
          `https://amplitude.com/api/2/export?start=${encodeURIComponent(start)}&end=${endDate}`,
          { headers: { Authorization: `Basic ${auth}` } }
        );
        if (!eventsResponse.ok) {
          return failedSync({
            source: AMPLITUDE_SOURCE,
            sourceName: AMPLITUDE_NAME,
            workspaceId,
            status: eventsResponse.status,
            rowsSynced,
          });
        }
        const events = parseExportLines(await eventsResponse.text());
        const writes: ActivityWrite[] = [];
        let lastIso: string | null = start.includes("T") ? start : null;
        for (const event of events) {
          const distinctId = event.user_id || event.amplitude_id;
          if (!event.event_type || distinctId == null || !event.event_time) continue;
          const eventDate = new Date(event.event_time);
          if (Number.isNaN(eventDate.getTime())) continue;
          const iso = eventDate.toISOString();
          since = laterIso(since, iso);
          lastIso = laterIso(lastIso, iso);
          const personId = `person_${distinctId}`;
          writes.push({
            personId,
            timestamp: eventDate,
            eventName: event.event_type,
            eventClass: classifyEvent(event.event_type),
            platform: event.platform || null,
            externalId: activityExternalId(AMPLITUDE_SOURCE, {
              nativeId: event.uuid || event.$insert_id,
              personId,
              timestamp: eventDate,
              eventName: event.event_type,
            }),
            workspaceId,
          });
        }
        rowsSynced += await insertActivitiesIdempotent(writes);
        if (events.length >= AMPLITUDE_EXPORT_LIMIT && lastIso) {
          start = lastIso;
          await persistCursor(workspaceId, {
            v: 1,
            phase: "events",
            page: lastIso,
            since,
          });
        } else {
          break;
        }
      }
    }

    const watermark = since ?? new Date().toISOString();
    const nextCursor = await persistCursor(workspaceId, {
      v: 1,
      phase: "caught_up",
      since: watermark,
    });

    await upsertSyncState({
      source: AMPLITUDE_SOURCE,
      sourceName: AMPLITUDE_NAME,
      lastSync: new Date(),
      status: "success",
      workspaceId,
    });

    console.log("Amplitude sync complete");
    return { rowsSynced, nextCursor, health: "ok" };
  } catch (error) {
    console.error("Amplitude sync failed");

    await upsertSyncState({
      source: AMPLITUDE_SOURCE,
      sourceName: AMPLITUDE_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });

    throw error;
  }
}
