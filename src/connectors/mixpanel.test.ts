import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { caughtUpCursor } from "./cursor";
import { sync } from "./index";
import { installFixtureFetch, type HttpFixture } from "./testing";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-mixpanel";
const WATERMARK = "2026-01-16T12:01:00.000Z";

const originalProject = process.env.MIXPANEL_PROJECT_ID;
const originalSecret = process.env.MIXPANEL_API_SECRET;

afterEach(async () => {
  restoreEnv("MIXPANEL_PROJECT_ID", originalProject);
  restoreEnv("MIXPANEL_API_SECRET", originalSecret);
  await clearWorkspace(WS);
});

function stubCredentials() {
  process.env.MIXPANEL_PROJECT_ID = "proj_fixture";
  process.env.MIXPANEL_API_SECRET = "mp_test";
}

async function countActivity(workspaceId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .all();
  return rows.length;
}

function engageUser(id: string) {
  return {
    $distinct_id: id,
    $properties: {
      $name: id,
      platform: "ios",
      $created: "2026-01-15T00:00:00.000Z",
    },
  };
}

describe("Mixpanel connector contract", () => {
  it("syncs via the registry against recorded fixtures", async () => {
    stubCredentials();

    await withOfflineSuite("mixpanel", ["mixpanel"], async (harness) => {
      const result = await sync("mixpanel", WS);

      expect(result).toEqual({
        rowsSynced: 3,
        nextCursor: caughtUpCursor(WATERMARK),
        health: "ok",
      });

      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.personId, "person_mp-ada"))
        .all();
      expect(users).toHaveLength(1);
      expect(users[0]?.name).toBe("Ada");
      expect(users[0]?.workspaceId).toBe(WS);

      const events = await db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.personId, "person_mp-ada"))
        .all();
      expect(events.map((e) => e.eventName).sort()).toEqual([
        "search_performed",
        "song_played",
      ]);

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.url).toContain("/engage");
      expect(harness.calls[1]?.url).toContain("/export");
    });
  });

  it("returns health error on 401 and does not advance the cursor", async () => {
    stubCredentials();

    await withOfflineSuite("mixpanel", ["mixpanel", "unauthorized"], async () => {
      const result = await sync("mixpanel", WS);
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

    await withOfflineSuite("mixpanel", ["mixpanel", "rate-limit"], async () => {
      const result = await sync("mixpanel", WS);
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

    await withOfflineSuite("mixpanel", ["mixpanel"], async (harness) => {
      await sync("mixpanel", WS);
      const before = await countActivity(WS);
      const afterFirst = harness.calls.length;
      const second = await sync("mixpanel", WS);
      const fetched = harness.calls.slice(afterFirst);
      expect(fetched.filter((call) => call.url.includes("/engage"))).toHaveLength(0);
      expect(fetched.filter((call) => call.url.includes("/export"))).toHaveLength(1);
      expect(fetched[0]?.url).toContain("where=");
      expect(second.rowsSynced).toBe(0);
      expect(await countActivity(WS)).toBe(before);
    });
  });

  it("paginates engage to completion", async () => {
    stubCredentials();
    const fixtures: HttpFixture[] = [
      {
        request: { method: "GET", urlIncludes: "where=" },
        response: { status: 200, headers: { "content-type": "text/plain" }, body: "" },
      },
      {
        request: { method: "GET", urlIncludes: "page=2" },
        response: {
          status: 200,
          body: {
            results: [engageUser("mp-page-2")],
            page: 2,
            session_id: "sess",
            page_size: 1,
            total: 3,
          },
        },
      },
      {
        request: { method: "GET", urlIncludes: "page=1" },
        response: {
          status: 200,
          body: {
            results: [engageUser("mp-page-1")],
            page: 1,
            session_id: "sess",
            page_size: 1,
            total: 3,
          },
        },
      },
      {
        request: { method: "GET", urlIncludes: "/engage" },
        response: {
          status: 200,
          body: {
            results: [engageUser("mp-page-0")],
            page: 0,
            session_id: "sess",
            page_size: 1,
            total: 3,
          },
        },
      },
      {
        request: { method: "GET", urlIncludes: "/export" },
        response: { status: 200, headers: { "content-type": "text/plain" }, body: "" },
      },
    ];

    const harness = installFixtureFetch(fixtures);
    try {
      const result = await sync("mixpanel", WS);
      expect(result.health).toBe("ok");
      expect(result.rowsSynced).toBe(3);
      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.workspaceId, WS))
        .all();
      expect(users.map((u) => u.personId).sort()).toEqual([
        "person_mp-page-0",
        "person_mp-page-1",
        "person_mp-page-2",
      ]);
      expect(harness.calls.filter((c) => c.url.includes("/engage"))).toHaveLength(3);
    } finally {
      harness.restore();
    }
  });
});
