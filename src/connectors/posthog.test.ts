import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { caughtUpCursor } from "./cursor";
import { sync } from "./index";
import { POSTHOG_EVENTS_LIMIT } from "./posthog";
import { installFixtureFetch, type HttpFixture } from "./testing";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-posthog";
const WS_BACKFILL = "backfill-25k";
const WATERMARK = "2026-01-16T12:01:00.000Z";
const BACKFILL_COUNT = 25_000;

const originalKey = process.env.POSTHOG_API_KEY;
const originalProject = process.env.POSTHOG_PROJECT_ID;
const originalHost = process.env.POSTHOG_HOST;

afterEach(async () => {
  restoreEnv("POSTHOG_API_KEY", originalKey);
  restoreEnv("POSTHOG_PROJECT_ID", originalProject);
  restoreEnv("POSTHOG_HOST", originalHost);
  await clearWorkspace(WS);
  await clearWorkspace(WS_BACKFILL);
});

function stubCredentials() {
  process.env.POSTHOG_API_KEY = "phx_test";
  process.env.POSTHOG_PROJECT_ID = "proj_fixture";
  process.env.POSTHOG_HOST = "https://app.posthog.com";
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function countActivity(workspaceId: string): Promise<number> {
  const rows = await db
    .select({ externalId: schema.activity.externalId })
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .all();
  return rows.length;
}

function backfillEvent(index: number) {
  const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + index * 1000);
  return {
    id: `ph-backfill-${index}`,
    distinct_id: `ph-u-${index % 50}`,
    event: "song_played",
    timestamp: timestamp.toISOString(),
    properties: { $device: "ios" },
  };
}

function backfillFixtures(): { fixtures: HttpFixture[]; lastIso: string } {
  const page1 = Array.from({ length: POSTHOG_EVENTS_LIMIT }, (_, i) => backfillEvent(i));
  const page2 = Array.from({ length: POSTHOG_EVENTS_LIMIT }, (_, i) =>
    backfillEvent(POSTHOG_EVENTS_LIMIT + i)
  );
  const page3 = Array.from(
    { length: BACKFILL_COUNT - POSTHOG_EVENTS_LIMIT * 2 },
    (_, i) => backfillEvent(POSTHOG_EVENTS_LIMIT * 2 + i)
  );
  const lastIso = page3[page3.length - 1]!.timestamp;
  const host = "https://app.posthog.com";
  const eventsBase = `${host}/api/projects/proj_fixture/events/?limit=${POSTHOG_EVENTS_LIMIT}`;
  return {
    lastIso,
    fixtures: [
      {
        request: { method: "GET", urlIncludes: "after=2026-" },
        response: { status: 200, body: { results: [], next: null } },
      },
      {
        request: { method: "GET", urlIncludes: "after=page-3" },
        response: { status: 200, body: { results: page3, next: null } },
      },
      {
        request: { method: "GET", urlIncludes: "after=page-2" },
        response: {
          status: 200,
          body: { results: page2, next: `${eventsBase}&after=page-3` },
        },
      },
      {
        request: { method: "GET", urlIncludes: "/persons/" },
        response: {
          status: 200,
          body: {
            results: [
              {
                distinct_ids: ["ph-backfill"],
                properties: { name: "Backfill", platform: "ios" },
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            next: null,
          },
        },
      },
      {
        request: { method: "GET", urlIncludes: "/events/" },
        response: {
          status: 200,
          body: { results: page1, next: `${eventsBase}&after=page-2` },
        },
      },
    ],
  };
}

describe("PostHog connector contract", () => {
  it("syncs via the registry against recorded fixtures", async () => {
    stubCredentials();

    await withOfflineSuite("posthog", ["posthog", "happy"], async (harness) => {
      const result = await sync("posthog", WS);

      expect(result).toEqual({
        rowsSynced: 3,
        nextCursor: caughtUpCursor(WATERMARK),
        health: "ok",
      });

      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.personId, "person_ph-ada"))
        .all();
      expect(users).toHaveLength(1);
      expect(users[0]?.name).toBe("Ada");
      expect(users[0]?.country).toBe("US");
      expect(users[0]?.timezone).toBe("America/Los_Angeles");
      expect(users[0]?.workspaceId).toBe(WS);

      const events = await db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.personId, "person_ph-ada"))
        .all();
      expect(events.map((e) => e.eventName).sort()).toEqual([
        "search_performed",
        "song_played",
      ]);
      expect(new Set(events.map((e) => e.externalId)).size).toBe(2);

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.url).toContain("/persons/");
      expect(harness.calls[1]?.url).toContain("/events/");
    });
  });

  it("returns health error on 401 and does not advance the cursor", async () => {
    stubCredentials();

    await withOfflineSuite("posthog", ["posthog", "unauthorized"], async () => {
      const result = await sync("posthog", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "unauthorized",
      });
    });
  });

  it("returns health error on rate-limit and does not advance the cursor", async () => {
    stubCredentials();

    await withOfflineSuite("posthog", ["posthog", "rate-limit"], async () => {
      const result = await sync("posthog", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "rate limited",
      });
    });
  });

  it("fetches and changes zero rows on a second sync of an unchanged source", async () => {
    stubCredentials();

    await withOfflineSuite("posthog", ["posthog", "happy"], async (harness) => {
      await sync("posthog", WS);
      const before = await countActivity(WS);
      const afterFirstCalls = harness.calls.length;

      const second = await sync("posthog", WS);
      const fetched = harness.calls.slice(afterFirstCalls);
      const eventCalls = fetched.filter((call) => call.url.includes("/events/"));
      const personCalls = fetched.filter((call) => call.url.includes("/persons/"));

      expect(personCalls).toHaveLength(0);
      expect(eventCalls).toHaveLength(1);
      expect(eventCalls[0]?.url).toContain("after=");
      expect(second.rowsSynced).toBe(0);
      expect(second.health).toBe("ok");
      expect(await countActivity(WS)).toBe(before);
    });
  });

  it(
    "lands a 25k-event backfill once and resumes a killed run without duplicates",
    async () => {
      stubCredentials();
      const { fixtures, lastIso } = backfillFixtures();

      const inner = installFixtureFetch(fixtures);
      const fixtureFetch = globalThis.fetch;
      let eventPages = 0;
      globalThis.fetch = async (input, init) => {
        const url = requestUrl(input);
        if (url.includes("/events/") && !url.includes("after=2026-")) {
          eventPages += 1;
          if (eventPages >= 2) {
            throw new Error("killed");
          }
        }
        return fixtureFetch(input, init);
      };

      try {
        const killed = await sync("posthog", WS_BACKFILL);
        expect(killed.health).toBe("error");
        expect(await countActivity(WS_BACKFILL)).toBe(POSTHOG_EVENTS_LIMIT);
      } finally {
        inner.restore();
      }

      const resumeHarness = installFixtureFetch(fixtures);
      try {
        const resumed = await sync("posthog", WS_BACKFILL);
        expect(resumed.health).toBe("ok");
        expect(resumed.nextCursor).toBe(caughtUpCursor(lastIso));

        const rows = await db
          .select({ externalId: schema.activity.externalId })
          .from(schema.activity)
          .where(eq(schema.activity.workspaceId, WS_BACKFILL))
          .all();
        expect(rows).toHaveLength(BACKFILL_COUNT);
        expect(new Set(rows.map((row) => row.externalId)).size).toBe(BACKFILL_COUNT);

        const before = rows.length;
        const afterResumeCalls = resumeHarness.calls.length;
        const second = await sync("posthog", WS_BACKFILL);
        const fetched = resumeHarness.calls.slice(afterResumeCalls);
        const fetchedEventRows = fetched.filter((call) => call.url.includes("/events/"));
        expect(fetchedEventRows).toHaveLength(1);
        expect(second.rowsSynced).toBe(0);
        expect(await countActivity(WS_BACKFILL)).toBe(before);
      } finally {
        resumeHarness.restore();
      }
    },
    60_000
  );

  it("does not fetch a PostHog host on cloud metadata", async () => {
    process.env.POSTHOG_API_KEY = "phx_test";
    process.env.POSTHOG_PROJECT_ID = "proj_fixture";
    process.env.POSTHOG_HOST = "http://169.254.169.254";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await sync("posthog", WS);
      expect(result.health).toBe("error");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not follow PostHog pagination or redirects onto metadata", async () => {
    stubCredentials();
    const harness = installFixtureFetch([
      {
        request: { method: "GET", urlIncludes: "/persons/" },
        response: {
          status: 200,
          body: {
            results: [],
            next: "http://169.254.169.254/latest/meta-data",
          },
        },
      },
      {
        request: { method: "GET", urlIncludes: "/events/" },
        response: {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
          body: "",
        },
      },
    ]);
    try {
      const result = await sync("posthog", WS);
      expect(result.health).toBe("error");
      expect(harness.calls.every((call) => !call.url.includes("169.254"))).toBe(
        true
      );
    } finally {
      harness.restore();
    }
  });
});
