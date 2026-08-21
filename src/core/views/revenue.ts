import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { and, eq } from "drizzle-orm";
import { PersonRevenueBlockSchema } from "@/core/contracts";
import {
  WEEK_MS,
  buildPersonRevenueBlock,
  buildRevenueLanes,
  countEventsInWeeks,
  runwayMonths,
  type RevenueLane,
  type RevenueLaneSeries,
} from "@/core/views/revenue-math";

export {
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
  wbrSectionId,
} from "@/core/views/revenue-math";

export type { PersonRevenueBlockInput, RevenueLane, RevenueLaneSeries } from "@/core/views/revenue-math";

const EMPTY_SERIES: RevenueLaneSeries = {
  mrrWeeks: [],
  mrrPrevWeeks: [],
  mrrMonths: [],
  mrrPrevMonths: [],
  subscriberWeeks: [],
  subscriberPrevWeeks: [],
  newWeeks: [],
  newPrevWeeks: [],
  churnedWeeks: [],
  churnedPrevWeeks: [],
  runwayWeeks: [],
  runwayPrevWeeks: [],
};

function lastSix<T>(rows: T[]): T[] {
  return rows.slice(-6);
}

function priorYear<T extends { period: Date }>(
  rows: T[],
  current: T[]
): T[] {
  if (current.length === 0) return [];
  const first = current[0].period.getTime() - 52 * WEEK_MS;
  const last = current[current.length - 1].period.getTime() - 50 * WEEK_MS;
  return rows.filter((row) => {
    const t = row.period.getTime();
    return t >= first - WEEK_MS && t <= last + WEEK_MS;
  });
}

export async function loadRevenueSeries(workspace: string): Promise<RevenueLaneSeries> {
  // Sequential: overview already holds a pool connection when it
  // calls loadWbrView, which calls this. A 3-wide Promise.all
  // contributed to postgres e2e ECONNRESET / 500 cascades.
  const snapshots = await db
    .select()
    .from(schema.mrrSnapshots)
    .where(eq(schema.mrrSnapshots.workspaceId, workspace))
    .all();
  const events = await db
    .select()
    .from(schema.subscriptionEvents)
    .where(eq(schema.subscriptionEvents.workspaceId, workspace))
    .all();
  const balances = await db
    .select()
    .from(schema.balanceSnapshots)
    .where(eq(schema.balanceSnapshots.workspaceId, workspace))
    .all();

  if (snapshots.length === 0 && events.length === 0 && balances.length === 0) {
    return EMPTY_SERIES;
  }

  const weekly = snapshots
    .filter((row) => row.grain === "week")
    .sort((a, b) => a.period.getTime() - b.period.getTime());
  const monthly = snapshots
    .filter((row) => row.grain === "month")
    .sort((a, b) => a.period.getTime() - b.period.getTime());

  const mrrCurrent = lastSix(
    weekly.filter((row) => {
      if (weekly.length <= 6) return true;
      const newest = weekly[weekly.length - 1].period.getTime();
      return row.period.getTime() >= newest - 8 * WEEK_MS;
    })
  );
  const mrrPrev = lastSix(priorYear(weekly, mrrCurrent));

  const weekStarts = mrrCurrent.map((row) => row.period);
  const prevStarts = mrrPrev.map((row) => row.period);

  const cash = balances
    .slice()
    .sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
  const cashCurrent = lastSix(
    cash.filter((row) => {
      if (cash.length <= 6) return true;
      const newest = cash[cash.length - 1].asOf.getTime();
      return row.asOf.getTime() >= newest - 8 * WEEK_MS;
    })
  );
  const cashPrev = lastSix(
    cash.filter((row) => {
      if (cashCurrent.length === 0) return false;
      const first = cashCurrent[0].asOf.getTime() - 52 * WEEK_MS;
      const last = cashCurrent[cashCurrent.length - 1].asOf.getTime() - 50 * WEEK_MS;
      const t = row.asOf.getTime();
      return t >= first - WEEK_MS && t <= last + WEEK_MS;
    })
  );

  return {
    mrrWeeks: mrrCurrent.map((row) => row.mrr),
    mrrPrevWeeks: mrrPrev.map((row) => row.mrr),
    mrrMonths: monthly.slice(-12).map((row) => row.mrr),
    mrrPrevMonths: monthly.slice(-24, -12).map((row) => row.mrr),
    subscriberWeeks: mrrCurrent.map((row) => row.subscriberCount),
    subscriberPrevWeeks: mrrPrev.map((row) => row.subscriberCount),
    newWeeks: countEventsInWeeks(events, "new", weekStarts),
    newPrevWeeks: countEventsInWeeks(events, "new", prevStarts),
    churnedWeeks: countEventsInWeeks(events, "churned", weekStarts),
    churnedPrevWeeks: countEventsInWeeks(events, "churned", prevStarts),
    runwayWeeks: cashCurrent.map((row) =>
      runwayMonths(row.cashBalance, row.monthlyBurn)
    ),
    runwayPrevWeeks: cashPrev.map((row) =>
      runwayMonths(row.cashBalance, row.monthlyBurn)
    ),
  };
}

export async function loadRevenueLanes(workspace: string): Promise<RevenueLane[]> {
  const series = await loadRevenueSeries(workspace);
  if (series.mrrWeeks.length === 0 && series.runwayWeeks.length === 0) {
    return [];
  }
  return buildRevenueLanes(series);
}

/**
 * Stable drill-down block for the person panel (ANY-20). Summarized charges
 * only — callers must not expect a raw charge list.
 */
export async function loadPersonRevenueBlock(
  workspace: string,
  personId: string
) {
  const [row] = await db
    .select()
    .from(schema.personRevenue)
    .where(
      and(
        eq(schema.personRevenue.workspaceId, workspace),
        eq(schema.personRevenue.personId, personId)
      )
    )
    .all();

  const events = await db
    .select()
    .from(schema.subscriptionEvents)
    .where(
      and(
        eq(schema.subscriptionEvents.workspaceId, workspace),
        eq(schema.subscriptionEvents.personId, personId)
      )
    )
    .all();

  if (!row) {
    return PersonRevenueBlockSchema.parse(
      buildPersonRevenueBlock({
        personId,
        workspaceId: workspace,
        status: "free",
        plan: null,
        mrr: 0,
        ltv: 0,
        currency: "usd",
        firstPaidAt: null,
        lastChargeAt: null,
        chargeCount: 0,
        lastChargeAmount: null,
        eventCount: events.length,
        startedAt: null,
        canceledAt: null,
      })
    );
  }

  const startedAt =
    events
      .filter((event) => event.eventType === "new")
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0]
      ?.occurredAt ?? row.firstPaidAt;
  const canceledAt =
    events
      .filter((event) => event.eventType === "churned")
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0]
      ?.occurredAt ?? null;

  const status =
    row.status === "active" ||
    row.status === "churned" ||
    row.status === "trial" ||
    row.status === "free"
      ? row.status
      : "free";

  return PersonRevenueBlockSchema.parse(
    buildPersonRevenueBlock({
      personId: row.personId,
      workspaceId: row.workspaceId,
      status,
      plan: row.plan,
      mrr: row.mrr,
      ltv: row.ltv,
      currency: row.currency,
      firstPaidAt: row.firstPaidAt,
      lastChargeAt: row.lastChargeAt,
      chargeCount: row.chargeCount,
      lastChargeAmount: row.lastChargeAmount,
      eventCount: events.length,
      startedAt: startedAt ?? null,
      canceledAt,
    })
  );
}
