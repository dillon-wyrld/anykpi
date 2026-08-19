/**
 * Revenue read-model math — MRR, churn, ARPU, runway, and the summarized
 * person charge block ANY-20 reads.
 *
 * WBR lanes reuse `seriesWowYoy` so WoW / YoY match the rest of the deck.
 */

import {
  round2,
  seriesWowYoy,
  wbrDecimals,
  wbrGoodDir,
  wbrStat,
} from "@/core/views/wbr-math";

export const WEEK_MS = 7 * 86400000;

export function arpu(mrr: number, subscribers: number): number {
  return subscribers > 0 ? round2(mrr / subscribers) : 0;
}

export function arpuSeries(mrr: number[], subscribers: number[]): number[] {
  return mrr.map((value, i) => arpu(value, subscribers[i] ?? 0));
}

/** Churned / starting subscribers as a percent. */
export function churnRate(churned: number, startingSubscribers: number): number {
  return startingSubscribers > 0
    ? round2((churned / startingSubscribers) * 100)
    : 0;
}

export function runwayMonths(cashBalance: number, monthlyBurn: number): number {
  if (monthlyBurn <= 0) return 0;
  return round2(cashBalance / monthlyBurn);
}

export function runwaySeries(cash: number[], monthlyBurn: number): number[] {
  return cash.map((value) => runwayMonths(value, monthlyBurn));
}

export function isPayerRow(row: {
  status: string;
  ltv?: number | null;
  chargeCount?: number | null;
  mrr?: number | null;
}): boolean {
  return (
    row.status === "active" ||
    row.status === "churned" ||
    (row.ltv ?? 0) > 0 ||
    (row.chargeCount ?? 0) > 0 ||
    (row.mrr ?? 0) > 0
  );
}

export function filterPayerUsers<T extends { personId: string }>(
  users: T[],
  payerIds: Iterable<string>
): T[] {
  const payers = new Set(payerIds);
  return users.filter((user) => payers.has(user.personId));
}

export function countEventsInWeeks(
  events: Array<{ eventType: string; occurredAt: Date }>,
  eventType: string,
  weekStarts: Date[],
  weekMs = WEEK_MS
): number[] {
  return weekStarts.map((start) => {
    const end = start.getTime() + weekMs;
    return events.filter(
      (event) =>
        event.eventType === eventType &&
        event.occurredAt.getTime() >= start.getTime() &&
        event.occurredAt.getTime() < end
    ).length;
  });
}

export function summarizeCharges(row: {
  ltv: number;
  chargeCount: number;
  lastChargeAmount: number | null;
  lastChargeAt: Date | null;
}): {
  count: number;
  total: number;
  lastAmount: number | null;
  lastAt: string | null;
} {
  return {
    count: row.chargeCount,
    total: round2(row.ltv),
    lastAmount: row.lastChargeAmount,
    lastAt: row.lastChargeAt ? row.lastChargeAt.toISOString() : null,
  };
}

export type PersonRevenueBlockInput = {
  personId: string;
  workspaceId: string;
  status: "active" | "churned" | "trial" | "free";
  plan: string | null;
  mrr: number;
  ltv: number;
  currency: string;
  firstPaidAt: Date | null;
  lastChargeAt: Date | null;
  chargeCount: number;
  lastChargeAmount: number | null;
  eventCount: number;
  startedAt: Date | null;
  canceledAt: Date | null;
};

export function buildPersonRevenueBlock(input: PersonRevenueBlockInput) {
  return {
    personId: input.personId,
    workspaceId: input.workspaceId,
    isPayer: isPayerRow(input),
    status: input.status,
    plan: input.plan,
    mrr: round2(input.mrr),
    ltv: round2(input.ltv),
    currency: input.currency,
    firstPaidAt: input.firstPaidAt ? input.firstPaidAt.toISOString() : null,
    charges: summarizeCharges({
      ltv: input.ltv,
      chargeCount: input.chargeCount,
      lastChargeAmount: input.lastChargeAmount,
      lastChargeAt: input.lastChargeAt,
    }),
    subscription: {
      eventCount: input.eventCount,
      startedAt: input.startedAt ? input.startedAt.toISOString() : null,
      canceledAt: input.canceledAt ? input.canceledAt.toISOString() : null,
    },
  };
}

export type RevenueLaneSeries = {
  mrrWeeks: number[];
  mrrPrevWeeks: number[];
  mrrMonths: number[];
  mrrPrevMonths: number[];
  subscriberWeeks: number[];
  subscriberPrevWeeks: number[];
  newWeeks: number[];
  newPrevWeeks: number[];
  churnedWeeks: number[];
  churnedPrevWeeks: number[];
  runwayWeeks: number[];
  runwayPrevWeeks: number[];
};

export type RevenueLane = {
  id: string;
  name: string;
  section: string;
  sectionOrder: string;
  owner: string;
  type: "input" | "output";
  current: number;
  target: number;
  wow: number;
  yoy: number;
  status: "ok" | "watch" | "off";
  statusReason: string | undefined;
  unit: string;
  goodDir: number;
  dp: number;
  weeks: number[];
  prevWeeks: number[];
  months: number[];
  prevMonths: number[];
  drivers: string[];
  note: null;
  source: string;
  syncAge: string;
};

function lane(
  spec: {
    id: string;
    name: string;
    owner: string;
    type: "input" | "output";
    unit: string;
    target: number;
    goodDir: "up" | "down";
    weeks: number[];
    prevWeeks: number[];
    months?: number[];
    prevMonths?: number[];
  }
): RevenueLane {
  const weeks = spec.weeks.map(round2);
  const prevWeeks = spec.prevWeeks.map(round2);
  const months = (spec.months ?? []).map(round2);
  const prevMonths = (spec.prevMonths ?? []).map(round2);
  const { current, wow, yoy } = seriesWowYoy(weeks, prevWeeks);
  const goodDir = wbrGoodDir(spec.goodDir);
  const dp = wbrDecimals(spec.unit);
  const stat = wbrStat({
    weeks,
    target: spec.target,
    goodDir,
    type: spec.type,
    unit: spec.unit,
    dp,
  });

  return {
    id: spec.id,
    name: spec.name,
    section: "fin",
    sectionOrder: "01",
    owner: spec.owner,
    type: spec.type,
    current,
    target: spec.target,
    wow,
    yoy,
    status: stat.k,
    statusReason: stat.why,
    unit: spec.unit,
    goodDir,
    dp,
    weeks,
    prevWeeks,
    months,
    prevMonths,
    drivers: [],
    note: null,
    source: "read model",
    syncAge: "live",
  };
}

/** WBR finance lanes derived from the revenue read models. */
export function buildRevenueLanes(series: RevenueLaneSeries): RevenueLane[] {
  const arpuWeeks = arpuSeries(series.mrrWeeks, series.subscriberWeeks);
  const arpuPrev = arpuSeries(series.mrrPrevWeeks, series.subscriberPrevWeeks);

  return [
    lane({
      id: "rev_mrr",
      name: "MRR",
      owner: "💳",
      type: "output",
      unit: "$",
      target: 600,
      goodDir: "up",
      weeks: series.mrrWeeks,
      prevWeeks: series.mrrPrevWeeks,
      months: series.mrrMonths,
      prevMonths: series.mrrPrevMonths,
    }),
    lane({
      id: "rev_new",
      name: "New subscriptions",
      owner: "🌱",
      type: "input",
      unit: "",
      target: 10,
      goodDir: "up",
      weeks: series.newWeeks,
      prevWeeks: series.newPrevWeeks,
    }),
    lane({
      id: "rev_churned",
      name: "Churned subscriptions",
      owner: "👻",
      type: "input",
      unit: "",
      target: 5,
      goodDir: "down",
      weeks: series.churnedWeeks,
      prevWeeks: series.churnedPrevWeeks,
    }),
    lane({
      id: "rev_arpu",
      name: "ARPU",
      owner: "💰",
      type: "output",
      unit: "$",
      target: 8,
      goodDir: "up",
      weeks: arpuWeeks,
      prevWeeks: arpuPrev,
    }),
    lane({
      id: "rev_runway",
      name: "Runway",
      owner: "🛫",
      type: "output",
      unit: "",
      target: 5,
      goodDir: "up",
      weeks: series.runwayWeeks,
      prevWeeks: series.runwayPrevWeeks,
    }),
  ];
}

export const WBR_SECTION_ID: Record<string, string> = {
  Finance: "fin",
  fin: "fin",
  Acquisition: "acq",
  acq: "acq",
  Activation: "act",
  act: "act",
  "Engagement & retention": "eng",
  eng: "eng",
  "Quality & support": "qua",
  qua: "qua",
};

export function wbrSectionId(section: string): string {
  return WBR_SECTION_ID[section] ?? section;
}
