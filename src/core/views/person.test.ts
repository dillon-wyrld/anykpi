import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { PersonRevenueBlockSchema } from "@/core/contracts";
import { firstLastSeen, isoWeekLabel, loadPersonPanel } from "./person";

const WS = "person-test";

afterEach(async () => {
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.personRevenue).where(eq(schema.personRevenue.workspaceId, WS));
  await db
    .delete(schema.subscriptionEvents)
    .where(eq(schema.subscriptionEvents.workspaceId, WS));
});

describe("isoWeekLabel / firstLastSeen", () => {
  it("labels a Thursday as its ISO week", () => {
    expect(isoWeekLabel(new Date("2026-08-19T15:00:00.000Z"))).toBe("2026-W34");
  });

  it("uses activity bounds when events exist, otherwise signup", () => {
    const signup = new Date("2026-01-01T00:00:00.000Z");
    const first = new Date("2026-02-01T00:00:00.000Z");
    const last = new Date("2026-03-01T00:00:00.000Z");
    expect(firstLastSeen(signup, [last, first])).toEqual({
      firstSeen: first,
      lastSeen: last,
    });
    expect(firstLastSeen(signup, [])).toEqual({
      firstSeen: signup,
      lastSeen: signup,
    });
  });
});

describe("loadPersonPanel", () => {
  it("returns timeline metadata and the ANY-45 revenue block", async () => {
    const signup = new Date("2026-07-01T00:00:00.000Z");
    const first = new Date("2026-07-02T12:00:00.000Z");
    const last = new Date("2026-08-10T08:00:00.000Z");

    await db.insert(schema.users).values({
      personId: "p-dave",
      name: "Dave",
      emoji: "🧢",
      platform: "IOS",
      country: "FR",
      cluster: "weekday",
      signupDate: signup,
      workspaceId: WS,
    });
    await db.insert(schema.activity).values([
      {
        personId: "p-dave",
        timestamp: last,
        eventName: "song_played",
        eventClass: "core",
        platform: "IOS",
        workspaceId: WS,
      },
      {
        personId: "p-dave",
        timestamp: first,
        eventName: "search_performed",
        eventClass: "search",
        platform: "IOS",
        workspaceId: WS,
      },
    ]);
    await db.insert(schema.personRevenue).values({
      personId: "p-dave",
      status: "active",
      plan: "starter",
      mrr: 8,
      ltv: 24,
      firstPaidAt: first,
      lastChargeAt: last,
      chargeCount: 3,
      lastChargeAmount: 8,
      currency: "usd",
      source: "demo",
      workspaceId: WS,
    });

    const panel = await loadPersonPanel(WS, "p-dave");
    expect(panel).not.toBeNull();
    if (!panel) throw new Error("expected panel");

    expect(panel.personId).toBe("p-dave");
    expect(panel.name).toBe("Dave");
    expect(panel.platform).toBe("IOS");
    expect(panel.cluster).toBe("weekday");
    expect(panel.cohort).toBe(isoWeekLabel(signup));
    expect(panel.firstSeen).toBe(first.toISOString());
    expect(panel.lastSeen).toBe(last.toISOString());
    expect(panel.events).toHaveLength(2);
    expect(panel.events[0].eventName).toBe("song_played");

    const revenue = PersonRevenueBlockSchema.parse(panel.revenue);
    expect(revenue.charges).toEqual({
      count: 3,
      total: 24,
      lastAmount: 8,
      lastAt: last.toISOString(),
    });
    expect(revenue).not.toHaveProperty("rawCharges");
    expect(Object.keys(revenue.charges).sort()).toEqual(
      ["count", "lastAmount", "lastAt", "total"].sort()
    );
  });

  it("returns null when the person is missing", async () => {
    expect(await loadPersonPanel(WS, "nobody")).toBeNull();
  });
});
