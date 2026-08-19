/**
 * Canonical demo revenue fixture. Stripe / RevenueCat later fill the same
 * read-model tables; views and golden tests read these numbers now.
 */

export const DEMO_REVENUE = {
  source: "demo",
  currency: "usd",
  /** Weekly MRR, oldest → newest. 656 / 80 = ARPU 8.2 */
  mrrWeeks: [497, 511, 490, 532, 553, 656],
  subscriberWeeks: [70, 70, 70, 70, 70, 80],
  prevMrrWeeks: [280, 290, 275, 300, 310, 320],
  prevSubscriberWeeks: [40, 40, 40, 42, 42, 44],
  /** New / churned counts keep subscriber_weeks consistent (70 → 80). */
  newWeeks: [4, 5, 3, 6, 5, 14],
  churnedWeeks: [4, 5, 3, 6, 5, 4],
  prevNewWeeks: [2, 2, 1, 3, 2, 5],
  prevChurnedWeeks: [2, 3, 2, 3, 3, 3],
  /** Cash path: burn $31k, last week $186k → 6.0 months runway. */
  cashWeeks: [167400, 170500, 173600, 176700, 179800, 186000],
  prevCashWeeks: [124000, 128000, 131000, 135000, 138000, 142000],
  monthlyBurn: 31000,
  starter: { plan: "starter", mrr: 8, count: 64 },
  plus: { plan: "plus", mrr: 9, count: 16 },
} as const;

export const WEEK_MS = 7 * 86400000;

export type DemoPersonRevenue = {
  personId: string;
  status: "active" | "churned";
  plan: string;
  mrr: number;
  ltv: number;
  firstPaidAt: Date;
  lastChargeAt: Date;
  chargeCount: number;
  lastChargeAmount: number;
};

export type DemoSubscriptionEvent = {
  personId: string;
  eventType: "new" | "churned";
  occurredAt: Date;
  mrrDelta: number;
  plan: string;
  sourceEventId: string;
};

export type DemoMrrSnapshot = {
  period: Date;
  grain: "week";
  mrr: number;
  subscriberCount: number;
};

export type DemoBalanceSnapshot = {
  asOf: Date;
  cashBalance: number;
  monthlyBurn: number;
  runwayMonths: number;
};

function weekStarts(anchor: Date, count = 6, yearsAgo = 0): Date[] {
  const origin = new Date(anchor.getTime() - yearsAgo * 52 * WEEK_MS);
  return Array.from({ length: count }, (_, i) =>
    new Date(origin.getTime() - (count - 1 - i) * WEEK_MS)
  );
}

/**
 * Assign pinned weekly series onto concrete person ids. Named users are
 * preferred as the active 80 so the demo faces are payers.
 */
export function buildDemoRevenue(
  personIds: string[],
  anchor: Date
): {
  people: DemoPersonRevenue[];
  events: DemoSubscriptionEvent[];
  mrrSnapshots: DemoMrrSnapshot[];
  balanceSnapshots: DemoBalanceSnapshot[];
} {
  const need =
    DEMO_REVENUE.subscriberWeeks[0] +
    DEMO_REVENUE.newWeeks.reduce((s, n) => s + n, 0);
  if (personIds.length < need) {
    throw new Error(`demo revenue needs ${need} person ids, got ${personIds.length}`);
  }

  const ids = personIds.slice(0, need);
  const initial = ids.slice(0, DEMO_REVENUE.subscriberWeeks[0]);
  const newcomers = ids.slice(DEMO_REVENUE.subscriberWeeks[0]);
  const weeks = weekStarts(anchor);
  const prevWeeks = weekStarts(anchor, 6, 1);

  const newByWeek: string[][] = [];
  let newCursor = 0;
  DEMO_REVENUE.newWeeks.forEach((n) => {
    newByWeek.push(newcomers.slice(newCursor, newCursor + n));
    newCursor += n;
  });

  const joinedAt = new Map<string, Date>();
  initial.forEach((id) => joinedAt.set(id, weeks[0]));
  newByWeek.forEach((group, i) => {
    group.forEach((id) => joinedAt.set(id, weeks[i]));
  });

  const active = new Set(initial);
  const churnedAt = new Map<string, Date>();
  const events: DemoSubscriptionEvent[] = [];

  // Initial 70 were already paying before the 6-week window — their "new"
  // event sits one week earlier so it does not inflate the latest new count.
  const beforeWindow = new Date(weeks[0].getTime() - WEEK_MS);
  initial.forEach((id) => {
    events.push({
      personId: id,
      eventType: "new",
      occurredAt: beforeWindow,
      mrrDelta: DEMO_REVENUE.starter.mrr,
      plan: DEMO_REVENUE.starter.plan,
      sourceEventId: `demo:new:${id}`,
    });
  });

  DEMO_REVENUE.newWeeks.forEach((_, i) => {
    newByWeek[i].forEach((id) => {
      active.add(id);
      events.push({
        personId: id,
        eventType: "new",
        occurredAt: weeks[i],
        mrrDelta: DEMO_REVENUE.starter.mrr,
        plan: DEMO_REVENUE.starter.plan,
        sourceEventId: `demo:new:${id}`,
      });
    });

    const churnable = [...active].filter((id) => !newByWeek[i].includes(id));
    const leaving = churnable.slice(0, DEMO_REVENUE.churnedWeeks[i]);
    leaving.forEach((id) => {
      active.delete(id);
      churnedAt.set(id, weeks[i]);
      events.push({
        personId: id,
        eventType: "churned",
        occurredAt: weeks[i],
        mrrDelta: -DEMO_REVENUE.starter.mrr,
        plan: DEMO_REVENUE.starter.plan,
        sourceEventId: `demo:churned:${id}`,
      });
    });
  });

  const activeIds = [...active];
  const plusIds = new Set(activeIds.slice(0, DEMO_REVENUE.plus.count));

  const people: DemoPersonRevenue[] = ids.map((personId) => {
    const firstPaidAt = joinedAt.get(personId)!;
    const left = churnedAt.get(personId);
    const isActive = active.has(personId);
    const plan = plusIds.has(personId)
      ? DEMO_REVENUE.plus.plan
      : DEMO_REVENUE.starter.plan;
    const price = plusIds.has(personId)
      ? DEMO_REVENUE.plus.mrr
      : DEMO_REVENUE.starter.mrr;
    const end = left ?? weeks[weeks.length - 1];
    const chargeCount = Math.max(
      1,
      Math.round((end.getTime() - firstPaidAt.getTime()) / WEEK_MS) + (left ? 0 : 1)
    );
    return {
      personId,
      status: isActive ? "active" : "churned",
      plan,
      mrr: isActive ? price : 0,
      ltv: price * chargeCount,
      firstPaidAt,
      lastChargeAt: end,
      chargeCount,
      lastChargeAmount: price,
    };
  });

  const mrrSnapshots: DemoMrrSnapshot[] = [
    ...weeks.map((period, i) => ({
      period,
      grain: "week" as const,
      mrr: DEMO_REVENUE.mrrWeeks[i],
      subscriberCount: DEMO_REVENUE.subscriberWeeks[i],
    })),
    ...prevWeeks.map((period, i) => ({
      period,
      grain: "week" as const,
      mrr: DEMO_REVENUE.prevMrrWeeks[i],
      subscriberCount: DEMO_REVENUE.prevSubscriberWeeks[i],
    })),
  ];

  const balanceSnapshots: DemoBalanceSnapshot[] = [
    ...weeks.map((asOf, i) => ({
      asOf,
      cashBalance: DEMO_REVENUE.cashWeeks[i],
      monthlyBurn: DEMO_REVENUE.monthlyBurn,
      runwayMonths: DEMO_REVENUE.cashWeeks[i] / DEMO_REVENUE.monthlyBurn,
    })),
    ...prevWeeks.map((asOf, i) => ({
      asOf,
      cashBalance: DEMO_REVENUE.prevCashWeeks[i],
      monthlyBurn: DEMO_REVENUE.monthlyBurn,
      runwayMonths: DEMO_REVENUE.prevCashWeeks[i] / DEMO_REVENUE.monthlyBurn,
    })),
  ];

  return { people, events, mrrSnapshots, balanceSnapshots };
}

export function preferPayerIds(namedIds: string[], allIds: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [...namedIds, ...allIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}
