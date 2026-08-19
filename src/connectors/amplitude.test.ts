import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { sync } from "./index";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-amplitude";

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

describe("Amplitude connector contract", () => {
  it("syncs via the registry against recorded fixtures", async () => {
    stubCredentials();

    await withOfflineSuite("amplitude", ["amplitude"], async (harness) => {
      const result = await sync("amplitude", WS);

      expect(result).toEqual({
        rowsSynced: 3,
        nextCursor: null,
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
});
