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

export const POSTHOG_SOURCE = "posthog";
export const POSTHOG_NAME = "PostHog";
export const POSTHOG_PERSONS_LIMIT = 1000;
export const POSTHOG_EVENTS_LIMIT = 10000;
const MAX_PAGES = 10_000;

type PersonRow = {
  distinct_ids?: string[];
  properties?: {
    name?: string;
    email?: string;
    emoji?: string;
    platform?: string;
    country?: string;
  };
  created_at?: string;
};

type EventRow = {
  id?: string;
  uuid?: string;
  distinct_id?: string;
  event?: string;
  timestamp?: string;
  properties?: { $device?: string };
};

function personsUrl(baseUrl: string, projectId: string): string {
  const url = new URL(`${baseUrl}/api/projects/${projectId}/persons/`);
  url.searchParams.set("limit", String(POSTHOG_PERSONS_LIMIT));
  return url.toString();
}

function eventsUrl(baseUrl: string, projectId: string, after?: string | null): string {
  const url = new URL(`${baseUrl}/api/projects/${projectId}/events/`);
  url.searchParams.set("limit", String(POSTHOG_EVENTS_LIMIT));
  if (after) url.searchParams.set("after", after);
  return url.toString();
}

function resolveNext(next: unknown, current: string): string | null {
  if (typeof next !== "string" || next.length === 0) return null;
  try {
    return new URL(next, current).toString();
  } catch {
    return null;
  }
}

async function persistCursor(
  workspaceId: string,
  cursor: SourceCursor
): Promise<string> {
  const encoded = encodeSourceCursor(cursor);
  await saveSyncCursor(workspaceId, POSTHOG_SOURCE, encoded);
  return encoded;
}

export async function syncPostHog(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials("posthog", opts?.config);
  const apiKey = credentials.apiKey;
  const projectId = credentials.projectId;

  if (!apiKey) {
    throw new Error("PostHog API key is required");
  }

  const baseUrl = credentials.host || "https://app.posthog.com";
  const headers = { Authorization: `Bearer ${apiKey}` };

  let rowsSynced = 0;
  let cursor = parseSourceCursor(opts?.cursor ?? (await loadSyncCursor(workspaceId, POSTHOG_SOURCE)));
  let since = cursor.since ?? null;

  try {
    if (cursor.phase === "persons") {
      let pageUrl = cursor.page || personsUrl(baseUrl, projectId ?? "");
      for (let pages = 0; pages < MAX_PAGES && pageUrl; pages++) {
        const personsResponse = await fetch(pageUrl, { headers });
        if (!personsResponse.ok) {
          return failedSync({
            source: POSTHOG_SOURCE,
            sourceName: POSTHOG_NAME,
            workspaceId,
            status: personsResponse.status,
            rowsSynced,
          });
        }
        const personsData = (await personsResponse.json()) as {
          results?: PersonRow[];
          next?: string | null;
        };
        for (const person of personsData.results || []) {
          const distinctId = person.distinct_ids?.[0];
          if (!distinctId) continue;
          rowsSynced += await insertUserIfAbsent({
            personId: `person_${distinctId}`,
            name: person.properties?.name || distinctId,
            email: person.properties?.email || null,
            emoji: person.properties?.emoji || null,
            platform: person.properties?.platform || null,
            country: person.properties?.country || null,
            signupDate: person.created_at ? new Date(person.created_at) : new Date(),
            workspaceId,
          });
        }
        const next = resolveNext(personsData.next, pageUrl);
        if (next && next !== pageUrl) {
          pageUrl = next;
          await persistCursor(workspaceId, { v: 1, phase: "persons", page: next, since });
        } else {
          pageUrl = "";
        }
      }
      cursor = { v: 1, phase: "events", since };
      await persistCursor(workspaceId, cursor);
    }

    if (cursor.phase === "events" || cursor.phase === "caught_up") {
      let pageUrl =
        cursor.phase === "events" && cursor.page
          ? cursor.page
          : eventsUrl(baseUrl, projectId ?? "", since);
      for (let pages = 0; pages < MAX_PAGES && pageUrl; pages++) {
        const eventsResponse = await fetch(pageUrl, { headers });
        if (!eventsResponse.ok) {
          return failedSync({
            source: POSTHOG_SOURCE,
            sourceName: POSTHOG_NAME,
            workspaceId,
            status: eventsResponse.status,
            rowsSynced,
          });
        }
        const eventsData = (await eventsResponse.json()) as {
          results?: EventRow[];
          next?: string | null;
        };
        const results = eventsData.results || [];
        const writes: ActivityWrite[] = [];
        for (const event of results) {
          if (!event.distinct_id || !event.event || !event.timestamp) continue;
          const eventDate = new Date(event.timestamp);
          if (Number.isNaN(eventDate.getTime())) continue;
          const iso = eventDate.toISOString();
          since = laterIso(since, iso);
          const personId = `person_${event.distinct_id}`;
          writes.push({
            personId,
            timestamp: eventDate,
            eventName: event.event,
            eventClass: classifyEvent(event.event),
            platform: event.properties?.$device || null,
            externalId: activityExternalId(POSTHOG_SOURCE, {
              nativeId: event.id || event.uuid,
              personId,
              timestamp: eventDate,
              eventName: event.event,
            }),
            workspaceId,
          });
        }
        rowsSynced += await insertActivitiesIdempotent(writes);
        const next = resolveNext(eventsData.next, pageUrl);
        if (next && next !== pageUrl && results.length > 0) {
          pageUrl = next;
          await persistCursor(workspaceId, {
            v: 1,
            phase: "events",
            page: next,
            since,
          });
        } else {
          pageUrl = "";
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
      source: POSTHOG_SOURCE,
      sourceName: POSTHOG_NAME,
      lastSync: new Date(),
      status: "success",
      workspaceId,
    });

    console.log("PostHog sync complete");
    return { rowsSynced, nextCursor, health: "ok" };
  } catch (error) {
    console.error("PostHog sync failed");

    await upsertSyncState({
      source: POSTHOG_SOURCE,
      sourceName: POSTHOG_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });

    throw error;
  }
}
