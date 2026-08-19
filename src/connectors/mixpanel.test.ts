import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { sync } from "./index";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-mixpanel";

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

describe("Mixpanel connector contract", () => {
  it("syncs via the registry against recorded fixtures", async () => {
    stubCredentials();

    await withOfflineSuite("mixpanel", ["mixpanel"], async (harness) => {
      const result = await sync("mixpanel", WS);

      expect(result).toEqual({
        rowsSynced: 3,
        nextCursor: null,
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
});
