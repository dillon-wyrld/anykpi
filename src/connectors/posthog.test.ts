import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { sync } from "./index";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-posthog";

const originalKey = process.env.POSTHOG_API_KEY;
const originalProject = process.env.POSTHOG_PROJECT_ID;
const originalHost = process.env.POSTHOG_HOST;

afterEach(async () => {
  restoreEnv("POSTHOG_API_KEY", originalKey);
  restoreEnv("POSTHOG_PROJECT_ID", originalProject);
  restoreEnv("POSTHOG_HOST", originalHost);
  await clearWorkspace(WS);
});

function stubCredentials() {
  process.env.POSTHOG_API_KEY = "phx_test";
  process.env.POSTHOG_PROJECT_ID = "proj_fixture";
  process.env.POSTHOG_HOST = "https://app.posthog.com";
}

describe("PostHog connector contract", () => {
  it("syncs via the registry against recorded fixtures", async () => {
    stubCredentials();

    await withOfflineSuite("posthog", ["posthog", "happy"], async (harness) => {
      const result = await sync("posthog", WS);

      expect(result).toEqual({
        rowsSynced: 3,
        nextCursor: null,
        health: "ok",
      });

      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.personId, "person_ph-ada"))
        .all();
      expect(users).toHaveLength(1);
      expect(users[0]?.name).toBe("Ada");
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
});
