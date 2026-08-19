import { describe, expect, it } from "vitest";
import { DEMO_REVENUE, buildDemoRevenue } from "@/demo/revenue";
import { PersonRevenueBlockSchema } from "@/core/contracts";
import { seriesPctChange, seriesWowYoy } from "@/core/views/wbr-math";
import {
  arpu,
  arpuSeries,
  buildPersonRevenueBlock,
  buildRevenueLanes,
  churnRate,
  countEventsInWeeks,
  filterPayerUsers,
  isPayerRow,
  runwayMonths,
  runwaySeries,
  summarizeCharges,
} from "./revenue-math";

const ANCHOR = new Date("2026-08-19T00:00:00.000Z");
const PERSON_IDS = Array.from({ length: 120 }, (_, i) => `p${i + 1}`);

describe("golden numbers on the demo revenue seed", () => {
  const fixture = buildDemoRevenue(PERSON_IDS, ANCHOR);
  const latestMrr = DEMO_REVENUE.mrrWeeks[5];
  const latestSubs = DEMO_REVENUE.subscriberWeeks[5];
  const priorSubs = DEMO_REVENUE.subscriberWeeks[4];

  it("pins MRR, subscriber count, and WoW from the weekly snapshots", () => {
    expect(latestMrr).toBe(656);
    expect(latestSubs).toBe(80);
    expect(DEMO_REVENUE.mrrWeeks[4]).toBe(553);
    expect(seriesWowYoy([...DEMO_REVENUE.mrrWeeks], [...DEMO_REVENUE.prevMrrWeeks])).toEqual({
      current: 656,
      wow: seriesPctChange(656, 553),
      yoy: seriesPctChange(656, 320),
    });
    expect(seriesPctChange(656, 553)).toBe(18.6);
    expect(fixture.mrrSnapshots.filter((s) => s.period.getTime() >= ANCHOR.getTime() - 6 * 7 * 86400000).at(-1)?.mrr).toBe(656);
  });

  it("pins churn count and rate against last week's starting subscribers", () => {
    const churned = DEMO_REVENUE.churnedWeeks[5];
    expect(churned).toBe(4);
    expect(churnRate(churned, priorSubs)).toBe(5.71);
    expect(churnRate(0, 0)).toBe(0);
    expect(DEMO_REVENUE.churnedWeeks.reduce((s, n) => s + n, 0)).toBe(
      fixture.people.filter((p) => p.status === "churned").length
    );
  });

  it("pins ARPU as MRR / subscribers on every seed week", () => {
    const weeks = arpuSeries([...DEMO_REVENUE.mrrWeeks], [...DEMO_REVENUE.subscriberWeeks]);
    expect(weeks).toEqual([7.1, 7.3, 7.0, 7.6, 7.9, 8.2]);
    expect(arpu(latestMrr, latestSubs)).toBe(8.2);
    expect(arpu(0, 0)).toBe(0);
    expect(seriesPctChange(8.2, 7.9)).toBe(3.8);
  });

  it("pins runway as cash / monthly burn on the seed balances", () => {
    const weeks = runwaySeries([...DEMO_REVENUE.cashWeeks], DEMO_REVENUE.monthlyBurn);
    expect(weeks).toEqual([5.4, 5.5, 5.6, 5.7, 5.8, 6]);
    expect(runwayMonths(186000, 31000)).toBe(6);
    expect(runwayMonths(186000, 0)).toBe(0);
    expect(seriesPctChange(6, 5.8)).toBe(3.4);
  });

  it("keeps new/churned event counts aligned with the subscriber path", () => {
    const currentSnaps = fixture.mrrSnapshots.filter(
      (s) => s.period.getTime() >= ANCHOR.getTime() - 5 * 7 * 86400000
    );
    const weekStarts = currentSnaps.map((s) => s.period);
    expect(countEventsInWeeks(fixture.events, "new", weekStarts)).toEqual([
      ...DEMO_REVENUE.newWeeks,
    ]);
    expect(countEventsInWeeks(fixture.events, "churned", weekStarts)).toEqual([
      ...DEMO_REVENUE.churnedWeeks,
    ]);
    expect(fixture.people.filter((p) => p.status === "active")).toHaveLength(80);
    const activeMrr = fixture.people
      .filter((p) => p.status === "active")
      .reduce((s, p) => s + p.mrr, 0);
    expect(activeMrr).toBe(64 * 8 + 16 * 9);
    expect(activeMrr).toBe(656);
  });
});

describe("WBR revenue lanes — WoW from the same series helpers", () => {
  const lanes = buildRevenueLanes({
    mrrWeeks: [...DEMO_REVENUE.mrrWeeks],
    mrrPrevWeeks: [...DEMO_REVENUE.prevMrrWeeks],
    mrrMonths: [],
    mrrPrevMonths: [],
    subscriberWeeks: [...DEMO_REVENUE.subscriberWeeks],
    subscriberPrevWeeks: [...DEMO_REVENUE.prevSubscriberWeeks],
    newWeeks: [...DEMO_REVENUE.newWeeks],
    newPrevWeeks: [...DEMO_REVENUE.prevNewWeeks],
    churnedWeeks: [...DEMO_REVENUE.churnedWeeks],
    churnedPrevWeeks: [...DEMO_REVENUE.prevChurnedWeeks],
    runwayWeeks: runwaySeries([...DEMO_REVENUE.cashWeeks], DEMO_REVENUE.monthlyBurn),
    runwayPrevWeeks: runwaySeries(
      [...DEMO_REVENUE.prevCashWeeks],
      DEMO_REVENUE.monthlyBurn
    ),
  });

  it("emits MRR, new, churned, ARPU, and runway with section fin", () => {
    expect(lanes.map((l) => l.id)).toEqual([
      "rev_mrr",
      "rev_new",
      "rev_churned",
      "rev_arpu",
      "rev_runway",
    ]);
    expect(new Set(lanes.map((l) => l.section))).toEqual(new Set(["fin"]));
  });

  it("uses seriesWowYoy for every lane so the deck WoW matches the math", () => {
    const mrr = lanes.find((l) => l.id === "rev_mrr")!;
    const arpuLane = lanes.find((l) => l.id === "rev_arpu")!;
    const runway = lanes.find((l) => l.id === "rev_runway")!;
    const churned = lanes.find((l) => l.id === "rev_churned")!;

    expect(mrr.current).toBe(656);
    expect(mrr.wow).toBe(18.6);
    expect(arpuLane.current).toBe(8.2);
    expect(arpuLane.wow).toBe(3.8);
    expect(runway.current).toBe(6);
    expect(runway.wow).toBe(3.4);
    expect(churned.current).toBe(4);
    expect(churned.wow).toBe(seriesPctChange(4, 5));
    expect(churned.goodDir).toBe(-1);
  });
});

describe("person revenue block — summarized charges, not a dump", () => {
  it("rolls charges into count / total / last and validates the contract", () => {
    const block = PersonRevenueBlockSchema.parse(
      buildPersonRevenueBlock({
        personId: "p1",
        workspaceId: "demo",
        status: "active",
        plan: "starter",
        mrr: 8,
        ltv: 48,
        currency: "usd",
        firstPaidAt: new Date("2026-07-08T00:00:00.000Z"),
        lastChargeAt: new Date("2026-08-19T00:00:00.000Z"),
        chargeCount: 6,
        lastChargeAmount: 8,
        eventCount: 1,
        startedAt: new Date("2026-07-08T00:00:00.000Z"),
        canceledAt: null,
      })
    );

    expect(block.isPayer).toBe(true);
    expect(block.charges).toEqual({
      count: 6,
      total: 48,
      lastAmount: 8,
      lastAt: "2026-08-19T00:00:00.000Z",
    });
    expect(block).not.toHaveProperty("rawCharges");
    expect(Object.keys(block.charges).sort()).toEqual(
      ["count", "lastAmount", "lastAt", "total"].sort()
    );
  });

  it("treats free / zero-ltv rows as non-payers", () => {
    expect(isPayerRow({ status: "free" })).toBe(false);
    expect(isPayerRow({ status: "active" })).toBe(true);
    expect(isPayerRow({ status: "churned" })).toBe(true);
    expect(summarizeCharges({
      ltv: 0,
      chargeCount: 0,
      lastChargeAmount: null,
      lastChargeAt: null,
    })).toEqual({ count: 0, total: 0, lastAmount: null, lastAt: null });
    expect(
      filterPayerUsers(
        [{ personId: "a" }, { personId: "b" }, { personId: "c" }],
        ["a", "c"]
      ).map((u) => u.personId)
    ).toEqual(["a", "c"]);
  });
});
