import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { caughtUpCursor } from "./cursor";
import { sync } from "./index";
import { installFixtureFetch, type HttpFixture } from "./testing";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-amplitude";
const WATERMARK = "2026-01-16T12:01:00.000Z";

const originalKey = process.env.AMPLITUDE_API_KEY;
const originalSecret = process.env.AMPLITUDE_SECRET_KEY;

afterEach(async () => {
  restoreEnv("AMPLITUDE_API_KEY", originalKey);
  restoreEnv("AMPLITUDE_SECRET_KEY", originalSecret);
  await clearWorkspace(WS);
});

function stubCredentials() {
  process.env.AMPLITUDE_API_KEY = "amp_test";
  process.env.AMPLITUDE_SECRET_KEY = "amp_secret_test";
}

async function countActivity(workspaceId: string): Promise<number> {
  const rows = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .all();
  return rows.length;
}

function ampUser(id: string) {
  return {
    user_id: id,
    amplitude_id: id,
    platform: "ios",
    country: "US",
    user_properties: { name: id, created_at: "2026-01-15T00:00:00.000Z" },
  };
}

describe("Amplitude connector contract", () => {
  it("syncs via the registry against recorded fixtures", async () => {
    stubCredentials();

    await withOfflineSuite("amplitude", ["amplitude"], async (harness) => {
      const result = await sync("amplitude", WS);

      expect(result).toEqual({
        rowsSynced: 3,
        nextCursor: caughtUpCursor(WATERMARK),
        health: "ok",
      });

      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.personId, "person_amp-ada"))
        .all();
      expect(users).toHaveLength(1);
      expect(users[0]?.name).toBe("Ada");
      expect(users[0]?.workspaceId).toBe(WS);

      const events = await db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.personId, "person_amp-ada"))
        .all();
      expect(events.map((e) => e.eventName).sort()).toEqual([
        "search_performed",
        "song_played",
      ]);

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.method).toBe("POST");
      expect(harness.calls[0]?.url).toContain("/usersearch");
      expect(harness.calls[1]?.url).toContain("/export");
    });
  });

  it("returns health error on 401 and does not advance the cursor", async () => {
    stubCredentials();

    await withOfflineSuite("amplitude", ["amplitude", "unauthorized"], async () => {
      const result = await sync("amplitude", WS);
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

    await withOfflineSuite("amplitude", ["amplitude", "rate-limit"], async () => {
      const result = await sync("amplitude", WS);
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

    await withOfflineSuite("amplitude", ["amplitude"], async (harness) => {
      await sync("amplitude", WS);
      const before = await countActivity(WS);
      const afterFirst = harness.calls.length;
      const second = await sync("amplitude", WS);
      const fetched = harness.calls.slice(afterFirst);
      expect(fetched.filter((call) => call.url.includes("/usersearch"))).toHaveLength(0);
      expect(fetched.filter((call) => call.url.includes("/export"))).toHaveLength(1);
      expect(fetched[0]?.url).toContain("start=2026-01-16T");
      expect(second.rowsSynced).toBe(0);
      expect(await countActivity(WS)).toBe(before);
    });
  });

  it("paginates user search to completion", async () => {
    stubCredentials();
    const fixtures: HttpFixture[] = [
      {
        request: { method: "GET", urlIncludes: "start=2026-01-16T" },
        response: { status: 200, headers: { "content-type": "text/plain" }, body: "" },
      },
      {
        request: { method: "POST", urlIncludes: "/usersearch" },
        response: {
          status: 200,
          body: { data: [ampUser("amp-page-0")], next: "page-2" },
        },
      },
      {
        request: { method: "GET", urlIncludes: "/export" },
        response: { status: 200, headers: { "content-type": "text/plain" }, body: "" },
      },
    ];

    // First match wins: a second usersearch page distinguished only by body.
    // Replay the same URL with a rotating payload.
    let userPages = 0;
    const inner = installFixtureFetch(fixtures);
    const fixtureFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/usersearch")) {
        userPages += 1;
        if (userPages === 1) {
          return new Response(
            JSON.stringify({ data: [ampUser("amp-page-0")], next: "page-2" }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(JSON.stringify({ data: [ampUser("amp-page-1")] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return fixtureFetch(input, init);
    };

    try {
      const result = await sync("amplitude", WS);
      expect(result.health).toBe("ok");
      expect(result.rowsSynced).toBe(2);
      expect(userPages).toBe(2);
      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.workspaceId, WS))
        .all();
      expect(users.map((u) => u.personId).sort()).toEqual([
        "person_amp-page-0",
        "person_amp-page-1",
      ]);
    } finally {
      inner.restore();
    }
  });
});
