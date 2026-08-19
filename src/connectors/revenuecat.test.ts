import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadSourceCiphertext, saveSourceConfig } from "@/core/sources";
import { sync } from "./index";
import { monthlyFromDuration, subscriptionMrr } from "./revenuecat";
import { clearWorkspace, restoreEnv, withOfflineSuite } from "./testing/offline";

const WS = "contract-revenuecat";
const KEY = "sk_test_fixture_secret";
const PROJECT = "proj_fixture";

const originalKey = process.env.REVENUECAT_API_KEY;
const originalProject = process.env.REVENUECAT_PROJECT_ID;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(async () => {
  restoreEnv("REVENUECAT_API_KEY", originalKey);
  restoreEnv("REVENUECAT_PROJECT_ID", originalProject);
  restoreEnv("ANYKPI_SECRET", originalSecret);
  await clearWorkspace(WS);
});

async function storeCredentials() {
  delete process.env.REVENUECAT_API_KEY;
  delete process.env.REVENUECAT_PROJECT_ID;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  await saveSourceConfig(WS, "revenuecat", {
    apiKey: KEY,
    projectId: PROJECT,
  });
}

describe("RevenueCat connector contract", () => {
  it("stores the secret via the sources store and writes trial, conversion, and churn", async () => {
    await storeCredentials();
    const ciphertext = await loadSourceCiphertext(WS, "revenuecat");
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(KEY);

    await withOfflineSuite("revenuecat", ["revenuecat", "happy"], async (harness) => {
      const result = await sync("revenuecat", WS);

      expect(result).toEqual({
        rowsSynced: 3,
        nextCursor: null,
        health: "ok",
      });

      expect(harness.calls).toHaveLength(5);
      expect(harness.calls[0]?.url).toMatch(
        /\/v2\/projects\/proj_fixture\/customers\?limit=100$/
      );
      expect(harness.calls[1]?.url).toContain("/customers/cus_trial/subscriptions");
      expect(harness.calls[2]?.url).toContain("/customers/cus_converted/subscriptions");
      expect(harness.calls[3]?.url).toContain("starting_after=cus_converted");
      expect(harness.calls[4]?.url).toContain("/customers/cus_churned/subscriptions");

      const people = await db
        .select()
        .from(schema.personRevenue)
        .where(eq(schema.personRevenue.workspaceId, WS))
        .all();
      expect(people).toHaveLength(3);
      expect(people.map((row) => row.source).every((source) => source === "revenuecat")).toBe(
        true
      );

      const byId = Object.fromEntries(people.map((row) => [row.personId, row]));
      expect(byId.cus_trial?.status).toBe("trial");
      expect(byId.cus_trial?.mrr).toBe(0);
      expect(byId.cus_trial?.plan).toBe("plus");
      expect(byId.cus_trial?.firstPaidAt).toBeNull();

      expect(byId.cus_converted?.status).toBe("active");
      expect(byId.cus_converted?.mrr).toBe(12);
      expect(byId.cus_converted?.plan).toBe("plus");
      expect(byId.cus_converted?.ltv).toBe(12);

      expect(byId.cus_churned?.status).toBe("churned");
      expect(byId.cus_churned?.mrr).toBe(0);
      expect(byId.cus_churned?.plan).toBe("starter");
      expect(byId.cus_churned?.ltv).toBe(24);

      const events = await db
        .select()
        .from(schema.subscriptionEvents)
        .where(eq(schema.subscriptionEvents.workspaceId, WS))
        .all();
      expect(events).toHaveLength(3);
      expect(events.map((row) => row.source).every((source) => source === "revenuecat")).toBe(
        true
      );
      const eventByPerson = Object.fromEntries(events.map((row) => [row.personId, row]));
      expect(eventByPerson.cus_trial?.eventType).toBe("new");
      expect(eventByPerson.cus_converted?.eventType).toBe("new");
      expect(eventByPerson.cus_churned?.eventType).toBe("churned");
      expect(eventByPerson.cus_trial?.sourceEventId).toBe("sub:sub_trial:new");
      expect(eventByPerson.cus_converted?.sourceEventId).toBe("sub:sub_converted:new");
      expect(eventByPerson.cus_churned?.sourceEventId).toBe("sub:sub_churned:churned");

      const snapshots = await db
        .select()
        .from(schema.mrrSnapshots)
        .where(eq(schema.mrrSnapshots.workspaceId, WS))
        .all();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.mrr).toBe(12);
      expect(snapshots[0]?.subscriberCount).toBe(1);
      expect(snapshots[0]?.source).toBe("revenuecat");
      expect(snapshots[0]?.grain).toBe("week");
    });
  });

  it("resumes from SyncResult.nextCursor for a single customer page", async () => {
    await storeCredentials();

    await withOfflineSuite("revenuecat", ["revenuecat", "happy"], async (harness) => {
      const page = await sync("revenuecat", WS, { cursor: "cus_converted" });
      expect(page).toEqual({
        rowsSynced: 1,
        nextCursor: null,
        health: "ok",
      });
      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.url).toContain("starting_after=cus_converted");
      expect(harness.calls[1]?.url).toContain("/customers/cus_churned/subscriptions");
    });
  });

  it("returns health error on 401 and does not advance the cursor", async () => {
    await storeCredentials();

    await withOfflineSuite("revenuecat", ["revenuecat", "unauthorized"], async () => {
      const result = await sync("revenuecat", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "unauthorized",
      });
    });
  });

  it("returns health error on rate-limit and does not advance the cursor", async () => {
    await storeCredentials();

    await withOfflineSuite("revenuecat", ["revenuecat", "rate-limit"], async () => {
      const result = await sync("revenuecat", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "rate limited",
      });
    });
  });

  it("never logs the secret key", async () => {
    await storeCredentials();
    const lines: string[] = [];
    const push = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    const log = vi.spyOn(console, "log").mockImplementation(push);
    const error = vi.spyOn(console, "error").mockImplementation(push);

    await withOfflineSuite("revenuecat", ["revenuecat", "happy"], async () => {
      await sync("revenuecat", WS);
    });

    expect(lines.join("\n")).not.toContain(KEY);
    log.mockRestore();
    error.mockRestore();
  });
});

describe("subscription MRR", () => {
  it("converts yearly prices to monthly", () => {
    expect(monthlyFromDuration(120, "P1Y")).toBe(10);
    expect(
      subscriptionMrr({
        id: "sub_year",
        entitlements: {
          items: [
            {
              products: {
                items: [
                  {
                    subscription: { duration: "P1Y" },
                    indicative_price: { amount_micros: 120000000 },
                  },
                ],
              },
            },
          ],
        },
      })
    ).toBe(10);
  });
});
