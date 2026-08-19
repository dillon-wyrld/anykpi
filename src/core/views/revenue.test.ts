import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { DEMO_REVENUE, buildDemoRevenue } from "@/demo/revenue";
import { loadCohortsView } from "./cohorts";
import { loadPersonRevenueBlock, loadRevenueLanes } from "./revenue";
import { loadWbrView } from "./wbr";

const WS = "rev-test";
const ANCHOR = new Date("2026-08-19T00:00:00.000Z");

async function seedMini(workspace = WS) {
  const ids = Array.from({ length: 120 }, (_, i) => `${workspace}-p${i + 1}`);
  const fixture = buildDemoRevenue(ids, ANCHOR);

  const visiblePayers = ids.slice(0, 5);
  const freeIds = Array.from({ length: 5 }, (_, i) => `${workspace}-free-${i + 1}`);
  await db.insert(schema.users).values(
    [...visiblePayers, ...freeIds].map((personId, i) => ({
      personId,
      name: `User ${i + 1}`,
      signupDate: new Date(ANCHOR.getTime() - (9 - i) * 7 * 86400000),
      workspaceId: workspace,
    }))
  );
  await db.insert(schema.activity).values(
    [...visiblePayers, ...freeIds].map((personId) => ({
      personId,
      timestamp: ANCHOR,
      eventName: "core",
      eventClass: "core",
      workspaceId: workspace,
    }))
  );

  for (const person of fixture.people) {
    await db.insert(schema.personRevenue).values({
      personId: person.personId,
      status: person.status,
      plan: person.plan,
      mrr: person.mrr,
      ltv: person.ltv,
      firstPaidAt: person.firstPaidAt,
      lastChargeAt: person.lastChargeAt,
      chargeCount: person.chargeCount,
      lastChargeAmount: person.lastChargeAmount,
      currency: "usd",
      source: "demo",
      workspaceId: workspace,
    });
  }
  for (const event of fixture.events) {
    await db.insert(schema.subscriptionEvents).values({
      personId: event.personId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      mrrDelta: event.mrrDelta,
      plan: event.plan,
      source: "demo",
      sourceEventId: event.sourceEventId,
      workspaceId: workspace,
    });
  }
  for (const snapshot of fixture.mrrSnapshots) {
    await db.insert(schema.mrrSnapshots).values({
      period: snapshot.period,
      grain: snapshot.grain,
      mrr: snapshot.mrr,
      subscriberCount: snapshot.subscriberCount,
      source: "demo",
      workspaceId: workspace,
    });
  }
  for (const snapshot of fixture.balanceSnapshots) {
    await db.insert(schema.balanceSnapshots).values({
      asOf: snapshot.asOf,
      cashBalance: snapshot.cashBalance,
      monthlyBurn: snapshot.monthlyBurn,
      runwayMonths: snapshot.runwayMonths,
      source: "demo",
      workspaceId: workspace,
    });
  }

  return { ids, fixture, visiblePayers, freeIds };
}

afterEach(async () => {
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.personRevenue).where(eq(schema.personRevenue.workspaceId, WS));
  await db
    .delete(schema.subscriptionEvents)
    .where(eq(schema.subscriptionEvents.workspaceId, WS));
  await db.delete(schema.mrrSnapshots).where(eq(schema.mrrSnapshots.workspaceId, WS));
  await db
    .delete(schema.balanceSnapshots)
    .where(eq(schema.balanceSnapshots.workspaceId, WS));
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, WS));
  await db.delete(schema.metricPoints).where(eq(schema.metricPoints.workspaceId, WS));
});

describe("loadWbrView — revenue lanes on the read models", () => {
  it("shows MRR, churn, ARPU, and runway with WoW on seeded snapshots", async () => {
    await seedMini();
    const { metrics } = await loadWbrView(WS);
    const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));

    expect(byId.rev_mrr.current).toBe(656);
    expect(byId.rev_mrr.wow).toBe(18.6);
    expect(byId.rev_mrr.section).toBe("fin");
    expect(byId.rev_arpu.current).toBe(8.2);
    expect(byId.rev_arpu.wow).toBe(3.8);
    expect(byId.rev_runway.current).toBe(6);
    expect(byId.rev_churned.current).toBe(4);
    expect(byId.rev_new.current).toBe(14);
    expect(byId.rev_new.weeks).toEqual([...DEMO_REVENUE.newWeeks]);
  });
});

describe("loadCohortsView — payer filter", () => {
  it("keeps only people on the revenue join when payers is set", async () => {
    const { visiblePayers } = await seedMini();
    const all = await loadCohortsView(WS, "week");
    const payers = await loadCohortsView(WS, "week", { payers: true });

    expect(all.users.length).toBe(10);
    expect(all.payers).toBe(false);
    expect(payers.payers).toBe(true);
    expect(payers.users.length).toBe(visiblePayers.length);
    expect(payers.users.length).toBeLessThan(all.users.length);
    expect(payers.users.every((u) => u.isPayer)).toBe(true);
    expect(new Set(payers.users.map((u) => u.personId))).toEqual(
      new Set(visiblePayers)
    );
  });

  it("still filters to payers when a compare split is set", async () => {
    const { visiblePayers } = await seedMini();
    const payers = await loadCohortsView(WS, "week", {
      payers: true,
      split: "platform",
    });
    expect(payers.payers).toBe(true);
    expect(payers.split).toBe("platform");
    expect(payers.users.every((u) => u.isPayer)).toBe(true);
    expect(new Set(payers.users.map((u) => u.personId))).toEqual(
      new Set(visiblePayers)
    );
    expect(payers.series.length).toBeLessThanOrEqual(3);
  });
});

describe("loadPersonRevenueBlock", () => {
  it("returns the summarized contract and a free block for unknowns", async () => {
    const { ids } = await seedMini();
    const paid = await loadPersonRevenueBlock(WS, ids[0]);
    expect(paid.isPayer).toBe(true);
    expect(paid.personId).toBe(ids[0]);
    expect(paid.charges.count).toBeGreaterThan(0);
    expect(paid.charges.total).toBeGreaterThan(0);
    expect(paid).not.toHaveProperty("charges.raw");

    const free = await loadPersonRevenueBlock(WS, "nobody");
    expect(free.isPayer).toBe(false);
    expect(free.status).toBe("free");
    expect(free.charges).toEqual({
      count: 0,
      total: 0,
      lastAmount: null,
      lastAt: null,
    });
  });
});

describe("loadRevenueLanes empty workspace", () => {
  it("returns no lanes when the read models are empty", async () => {
    expect(await loadRevenueLanes("empty-workspace")).toEqual([]);
  });
});
