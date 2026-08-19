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

export const MIXPANEL_SOURCE = "mixpanel";
export const MIXPANEL_NAME = "Mixpanel";
export const MIXPANEL_ENGAGE_PAGE_SIZE = 1000;
export const MIXPANEL_EXPORT_LIMIT = 10000;
const MAX_PAGES = 10_000;

type EngageUser = {
  $distinct_id?: string;
  $properties?: {
    $name?: string;
    $email?: string;
    emoji?: string;
    platform?: string;
    $country_code?: string;
    $created?: string;
  };
};

type ExportEvent = {
  event?: string;
  properties?: {
    distinct_id?: string;
    time?: number;
    $device?: string;
    $insert_id?: string;
  };
};

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function engageUrl(projectId: string, sessionId?: string | null, page?: number): string {
  const url = new URL("https://mixpanel.com/api/2.0/engage");
  url.searchParams.set("project_id", projectId);
  url.searchParams.set("page_size", String(MIXPANEL_ENGAGE_PAGE_SIZE));
  if (sessionId) url.searchParams.set("session_id", sessionId);
  if (page != null && page > 0) url.searchParams.set("page", String(page));
  return url.toString();
}

function exportUrl(
  projectId: string,
  fromDate: string,
  toDate: string,
  afterTime?: string | null
): string {
  const url = new URL("https://data.mixpanel.com/api/2.0/export");
  url.searchParams.set("project_id", projectId);
  url.searchParams.set("from_date", fromDate);
  url.searchParams.set("to_date", toDate);
  url.searchParams.set("limit", String(MIXPANEL_EXPORT_LIMIT));
  if (afterTime) {
    url.searchParams.set("where", `properties["time"]>${afterTime}`);
  }
  return url.toString();
}

function parseEngagePage(page: string | null | undefined): {
  sessionId: string | null;
  page: number;
} {
  if (!page) return { sessionId: null, page: 0 };
  const [sessionId, rawPage] = page.split(":");
  const parsed = Number(rawPage);
  return {
    sessionId: sessionId || null,
    page: Number.isFinite(parsed) ? parsed : 0,
  };
}

async function persistCursor(workspaceId: string, cursor: SourceCursor): Promise<string> {
  const encoded = encodeSourceCursor(cursor);
  await saveSyncCursor(workspaceId, MIXPANEL_SOURCE, encoded);
  return encoded;
}

function parseExportLines(text: string): ExportEvent[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ExportEvent);
}

export async function syncMixpanel(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials("mixpanel", opts?.config);
  const projectId = credentials.projectId;
  const apiSecret = credentials.apiSecret;

  if (!projectId || !apiSecret) {
    throw new Error("Mixpanel project ID and API secret are required");
  }

  const auth = Buffer.from(`${apiSecret}:`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };

  let rowsSynced = 0;
  let cursor = parseSourceCursor(
    opts?.cursor ?? (await loadSyncCursor(workspaceId, MIXPANEL_SOURCE))
  );
  let since = cursor.since ?? null;

  try {
    if (cursor.phase === "persons") {
      let { sessionId, page } = parseEngagePage(cursor.page);
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const usersResponse = await fetch(engageUrl(projectId, sessionId, page), {
          headers,
        });
        if (!usersResponse.ok) {
          return failedSync({
            source: MIXPANEL_SOURCE,
            sourceName: MIXPANEL_NAME,
            workspaceId,
            status: usersResponse.status,
            rowsSynced,
          });
        }
        const usersData = (await usersResponse.json()) as {
          results?: EngageUser[];
          page?: number;
          session_id?: string;
          page_size?: number;
          total?: number;
        };
        const results = usersData.results || [];
        for (const user of results) {
          if (!user.$distinct_id) continue;
          rowsSynced += await insertUserIfAbsent({
            personId: `person_${user.$distinct_id}`,
            name: user.$properties?.$name || user.$distinct_id,
            email: user.$properties?.$email || null,
            emoji: user.$properties?.emoji || null,
            platform: user.$properties?.platform || null,
            country: user.$properties?.$country_code || null,
            signupDate: user.$properties?.$created
              ? new Date(user.$properties.$created)
              : new Date(),
            workspaceId,
          });
        }
        sessionId = usersData.session_id ?? sessionId;
        const pageSize = usersData.page_size ?? MIXPANEL_ENGAGE_PAGE_SIZE;
        const currentPage = usersData.page ?? page;
        const total = usersData.total;
        const hasMore =
          (typeof total === "number" && (currentPage + 1) * pageSize < total) ||
          results.length >= MIXPANEL_ENGAGE_PAGE_SIZE;
        if (hasMore) {
          page = currentPage + 1;
          await persistCursor(workspaceId, {
            v: 1,
            phase: "persons",
            page: `${sessionId ?? ""}:${page}`,
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
      const toDate = isoDate(new Date());
      const fromDate = isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      let afterTime =
        cursor.phase === "events" && cursor.page
          ? cursor.page
          : cursor.phase === "caught_up" && since
            ? String(Math.floor(new Date(since).getTime() / 1000))
            : null;

      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const eventsResponse = await fetch(
          exportUrl(projectId, fromDate, toDate, afterTime),
          { headers }
        );
        if (!eventsResponse.ok) {
          return failedSync({
            source: MIXPANEL_SOURCE,
            sourceName: MIXPANEL_NAME,
            workspaceId,
            status: eventsResponse.status,
            rowsSynced,
          });
        }
        const events = parseExportLines(await eventsResponse.text());
        const writes: ActivityWrite[] = [];
        let lastTime: number | null = afterTime ? Number(afterTime) : null;
        for (const event of events) {
          const distinctId = event.properties?.distinct_id;
          const time = event.properties?.time;
          if (!event.event || !distinctId || time == null) continue;
          const eventDate = new Date(time * 1000);
          if (Number.isNaN(eventDate.getTime())) continue;
          since = laterIso(since, eventDate.toISOString());
          lastTime = lastTime == null ? time : Math.max(lastTime, time);
          const personId = `person_${distinctId}`;
          writes.push({
            personId,
            timestamp: eventDate,
            eventName: event.event,
            eventClass: classifyEvent(event.event),
            platform: event.properties?.$device || null,
            externalId: activityExternalId(MIXPANEL_SOURCE, {
              nativeId: event.properties?.$insert_id,
              personId,
              timestamp: eventDate,
              eventName: event.event,
            }),
            workspaceId,
          });
        }
        rowsSynced += await insertActivitiesIdempotent(writes);
        if (events.length >= MIXPANEL_EXPORT_LIMIT && lastTime != null) {
          afterTime = String(lastTime);
          await persistCursor(workspaceId, {
            v: 1,
            phase: "events",
            page: afterTime,
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
      source: MIXPANEL_SOURCE,
      sourceName: MIXPANEL_NAME,
      lastSync: new Date(),
      status: "success",
      workspaceId,
    });

    console.log("Mixpanel sync complete");
    return { rowsSynced, nextCursor, health: "ok" };
  } catch (error) {
    console.error("Mixpanel sync failed");

    await upsertSyncState({
      source: MIXPANEL_SOURCE,
      sourceName: MIXPANEL_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });

    throw error;
  }
}
