import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { sqlEngine } from "./dialect";
import { excluded } from "./query-compat";
import * as schema from "./schema";
import { loadCalendarView } from "./views/calendar";
import { loadCohortsView } from "./views/cohorts";
import { loadPersonPanel } from "./views/person";
import { loadRevenueSeries } from "./views/revenue";
import { loadWbrView } from "./views/wbr";

const WS = "query-compat";

afterEach(async () => {
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, WS));
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, WS));
  await db
    .delete(schema.metricPoints)
    .where(eq(schema.metricPoints.workspaceId, WS));
  await db
    .delete(schema.mrrSnapshots)
    .where(eq(schema.mrrSnapshots.workspaceId, WS));
  await db
    .delete(schema.personRevenue)
    .where(eq(schema.personRevenue.workspaceId, WS));
  await db
    .delete(schema.subscriptionEvents)
    .where(eq(schema.subscriptionEvents.workspaceId, WS));
  await db
    .delete(schema.balanceSnapshots)
    .where(eq(schema.balanceSnapshots.workspaceId, WS));
});

describe("query compat on the active engine", () => {
  it(`maps timestamps to Date and serves views on ${sqlEngine()}`, async () => {
    const signup = new Date("2026-06-01T00:00:00.000Z");
    const seen = new Date("2026-06-08T12:00:00.000Z");
    const period = new Date("2026-06-08T00:00:00.000Z");

    await db.insert(schema.users).values({
      personId: "p-compat",
      name: "Compat",
      emoji: "🧪",
      platform: "web",
      country: "US",
      cluster: "daily",
      signupDate: signup,
      workspaceId: WS,
    });
    await db.insert(schema.activity).values({
      personId: "p-compat",
      timestamp: seen,
      eventName: "song_played",
      eventClass: "core",
      platform: "web",
      workspaceId: WS,
    });
    await db.insert(schema.calEvents).values({
      source: "demo",
      sourceName: "Demo",
      sourceColor: "#000",
      type: "ritual",
      emoji: "📅",
      title: "WBR",
      badge: "weekly",
      eventDate: seen,
      isFuture: false,
      workspaceId: WS,
    });
    await db.insert(schema.mrrSnapshots).values({
      period,
      grain: "week",
      mrr: 10,
      subscriberCount: 1,
      source: "demo",
      workspaceId: WS,
    });

    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    expect(user?.signupDate).toBeInstanceOf(Date);
    expect(user?.signupDate?.toISOString()).toBe(signup.toISOString());

    const event = await db
      .select()
      .from(schema.calEvents)
      .where(eq(schema.calEvents.workspaceId, WS))
      .get();
    expect(event?.eventDate).toBeInstanceOf(Date);
    expect(event?.isFuture).toBe(false);

    const person = await loadPersonPanel(WS, "p-compat");
    expect(person?.firstSeen).toBe(seen.toISOString());
    expect(person?.events).toHaveLength(1);

    const cohorts = await loadCohortsView(WS, "week");
    expect(cohorts.users).toHaveLength(1);
    expect(cohorts.baseDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const calendar = await loadCalendarView(WS);
    expect(calendar.events.some((row) => row.title === "WBR")).toBe(true);

    const revenue = await loadRevenueSeries(WS);
    expect(revenue.mrrWeeks).toEqual([10]);

    const wbr = await loadWbrView(WS);
    expect(Array.isArray(wbr.metrics)).toBe(true);
  });

  it("emits the shared ON CONFLICT excluded alias", () => {
    expect(JSON.stringify(excluded("name"))).toMatch(/excluded\.name/);
  });
});
