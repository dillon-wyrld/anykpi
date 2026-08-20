/**
 * RevenueCat connector — mobile-subscription backfill into ANY-45.
 *
 * Secret key via the sources store (ANY-46). Never logs credentials.
 * Writes the same revenue tables as Stripe. Fully parallel — not a
 * Stripe wrapper and not gated on Stripe sync.
 *
 * Backfill lists customers, one page at a time when a cursor is
 * supplied, otherwise paginates to completion. Each customer’s
 * subscriptions are pulled and mapped to trial / conversion / churn.
 * `nextCursor` is the customer `starting_after` id when more pages remain.
 */

import { and, eq } from "drizzle-orm";
import type { SyncResult } from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { isTombstoned } from "@/core/tombstones";
import { upsertSyncState } from "@/core/upsert";
import { resolveCredentials } from "./credentials";
import { failedSync } from "./http-status";
import type { SyncOpts } from "./types";

export const REVENUECAT_SOURCE = "revenuecat";
export const REVENUECAT_NAME = "RevenueCat";
export const REVENUECAT_API = "https://api.revenuecat.com/v2";
export const REVENUECAT_PAGE_SIZE = 100;
export const REVENUECAT_MAX_PAGES = 50;

export type RevenueCatMonetary = {
  currency?: string | null;
  gross?: number | null;
};

export type RevenueCatIndicativePrice = {
  currency?: string | null;
  amount_micros?: number | string | null;
  amount?: number | null;
};

export type RevenueCatProduct = {
  id?: string;
  display_name?: string | null;
  store_identifier?: string | null;
  subscription?: { duration?: string | null } | null;
  indicative_price?: RevenueCatIndicativePrice | null;
};

export type RevenueCatEntitlement = {
  display_name?: string | null;
  products?: { items?: RevenueCatProduct[] } | null;
};

export type RevenueCatSubscription = {
  id: string;
  customer_id?: string | null;
  product_id?: string | null;
  status?: string | null;
  starts_at?: number | null;
  current_period_starts_at?: number | null;
  ends_at?: number | null;
  gives_access?: boolean | null;
  total_revenue_in_usd?: RevenueCatMonetary | null;
  entitlements?: { items?: RevenueCatEntitlement[] } | null;
};

export type RevenueCatCustomer = {
  id: string;
};

export type RevenueCatList<T> = {
  items?: T[];
  next_page?: string | null;
};

type PersonStatus = "active" | "churned" | "trial" | "free";
type SubEventType = "new" | "churned" | "renewed" | "upgraded" | "downgraded";

function firstProduct(sub: RevenueCatSubscription): RevenueCatProduct | null {
  for (const entitlement of sub.entitlements?.items ?? []) {
    const product = entitlement.products?.items?.[0];
    if (product) return product;
  }
  return null;
}

export function personIdFromCustomer(
  customerId: string | null | undefined
): string | null {
  return customerId && customerId.length > 0 ? customerId : null;
}

export function planName(sub: RevenueCatSubscription): string | null {
  const product = firstProduct(sub);
  return (
    product?.display_name ||
    product?.store_identifier ||
    product?.id ||
    sub.product_id ||
    sub.entitlements?.items?.[0]?.display_name ||
    null
  );
}

export function personStatus(
  status: string | null | undefined,
  givesAccess?: boolean | null
): PersonStatus {
  switch (status) {
    case "active":
    case "in_grace_period":
      return "active";
    case "trialing":
      return "trial";
    case "expired":
      return "churned";
    case "in_billing_retry":
    case "paused":
      return givesAccess ? "active" : "churned";
    default:
      return "free";
  }
}

function contributingMrr(status: PersonStatus, mrr: number): number {
  return status === "active" ? mrr : 0;
}

function dollarsFromMicros(micros: number | string | null | undefined): number | null {
  if (micros === null || micros === undefined || micros === "") return null;
  const value = typeof micros === "string" ? Number(micros) : micros;
  if (!Number.isFinite(value)) return null;
  return value / 1_000_000;
}

/**
 * Convert a store price + ISO-8601 product duration (P1M, P1Y, P1W, …)
 * into monthly recurring revenue.
 */
export function monthlyFromDuration(amount: number, isoDuration?: string | null): number {
  const match = /^(?:P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?)$/i.exec(
    isoDuration ?? "P1M"
  );
  const years = Number(match?.[1] ?? 0);
  const months = Number(match?.[2] ?? 0);
  const weeks = Number(match?.[3] ?? 0);
  const days = Number(match?.[4] ?? 0);
  if (years > 0) return amount / (years * 12);
  if (months > 0) return amount / months;
  if (weeks > 0) return (amount * 52) / 12 / weeks;
  if (days > 0) return (amount * 30) / days;
  return amount;
}

export function subscriptionMrr(sub: RevenueCatSubscription): number {
  const product = firstProduct(sub);
  const fromMicros = dollarsFromMicros(product?.indicative_price?.amount_micros);
  const amount =
    fromMicros ??
    (typeof product?.indicative_price?.amount === "number"
      ? product.indicative_price.amount
      : 0);
  return Math.round(monthlyFromDuration(amount, product?.subscription?.duration) * 100) / 100;
}

export function utcWeekStart(at: Date = new Date()): Date {
  const utc = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc;
}

function msToDate(ms: number | null | undefined): Date | null {
  if (!ms || ms <= 0) return null;
  return new Date(ms < 1e12 ? ms * 1000 : ms);
}

function authHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

function customersUrl(projectId: string, cursor?: string): string {
  const url = new URL(`${REVENUECAT_API}/projects/${projectId}/customers`);
  url.searchParams.set("limit", String(REVENUECAT_PAGE_SIZE));
  if (cursor) url.searchParams.set("starting_after", cursor);
  return url.toString();
}

function subscriptionsUrl(projectId: string, customerId: string): string {
  const url = new URL(
    `${REVENUECAT_API}/projects/${projectId}/customers/${encodeURIComponent(customerId)}/subscriptions`
  );
  url.searchParams.set("limit", String(REVENUECAT_PAGE_SIZE));
  return url.toString();
}

function projectsUrl(): string {
  const url = new URL(`${REVENUECAT_API}/projects`);
  url.searchParams.set("limit", "20");
  return url.toString();
}

async function upsertPersonRevenue(row: {
  personId: string;
  accountId: string | null;
  status: PersonStatus;
  plan: string | null;
  mrr: number;
  ltv?: number;
  firstPaidAt: Date | null;
  lastChargeAt?: Date | null;
  chargeCount?: number;
  lastChargeAmount?: number | null;
  currency: string;
  workspaceId: string;
}): Promise<void> {
  if (await isTombstoned(row.workspaceId, row)) return;
  const existing = await db
    .select()
    .from(schema.personRevenue)
    .where(
      and(
        eq(schema.personRevenue.workspaceId, row.workspaceId),
        eq(schema.personRevenue.personId, row.personId)
      )
    )
    .get();

  const firstPaidAt = row.firstPaidAt ?? existing?.firstPaidAt ?? null;
  const lastChargeAt = row.lastChargeAt ?? existing?.lastChargeAt ?? null;
  const chargeCount = row.chargeCount ?? existing?.chargeCount ?? 0;
  const lastChargeAmount =
    row.lastChargeAmount !== undefined
      ? row.lastChargeAmount
      : existing?.lastChargeAmount ?? null;
  const ltv = row.ltv !== undefined ? row.ltv : existing?.ltv ?? 0;

  await db
    .insert(schema.personRevenue)
    .values({
      personId: row.personId,
      accountId: row.accountId,
      status: row.status,
      plan: row.plan,
      mrr: contributingMrr(row.status, row.mrr),
      ltv,
      firstPaidAt,
      lastChargeAt,
      chargeCount,
      lastChargeAmount,
      currency: row.currency,
      source: REVENUECAT_SOURCE,
      workspaceId: row.workspaceId,
    })
    .onConflictDoUpdate({
      target: [schema.personRevenue.workspaceId, schema.personRevenue.personId],
      set: {
        accountId: row.accountId,
        status: row.status,
        plan: row.plan,
        mrr: contributingMrr(row.status, row.mrr),
        ltv,
        firstPaidAt,
        lastChargeAt,
        chargeCount,
        lastChargeAmount,
        currency: row.currency,
        source: REVENUECAT_SOURCE,
      },
    });
}

async function insertSubscriptionEvent(row: {
  personId: string;
  accountId: string | null;
  eventType: SubEventType;
  occurredAt: Date;
  mrrDelta: number;
  plan: string | null;
  sourceEventId: string;
  workspaceId: string;
}): Promise<boolean> {
  if (await isTombstoned(row.workspaceId, { personId: row.personId, accountId: row.accountId })) {
    return false;
  }
  await db
    .insert(schema.subscriptionEvents)
    .values({
      personId: row.personId,
      accountId: row.accountId,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      mrrDelta: row.mrrDelta,
      plan: row.plan,
      source: REVENUECAT_SOURCE,
      sourceEventId: row.sourceEventId,
      workspaceId: row.workspaceId,
    })
    .onConflictDoNothing({
      target: [
        schema.subscriptionEvents.workspaceId,
        schema.subscriptionEvents.source,
        schema.subscriptionEvents.sourceEventId,
      ],
    });
  return true;
}

export async function refreshRevenueCatMrrSnapshot(workspaceId: string): Promise<void> {
  const people = await db
    .select()
    .from(schema.personRevenue)
    .where(
      and(
        eq(schema.personRevenue.workspaceId, workspaceId),
        eq(schema.personRevenue.source, REVENUECAT_SOURCE)
      )
    )
    .all();

  const mrr = people.reduce((sum, row) => sum + (row.status === "active" ? row.mrr : 0), 0);
  const subscriberCount = people.filter(
    (row) => row.status === "active" && row.mrr > 0
  ).length;
  const period = utcWeekStart();

  await db
    .insert(schema.mrrSnapshots)
    .values({
      period,
      grain: "week",
      mrr,
      subscriberCount,
      source: REVENUECAT_SOURCE,
      workspaceId,
    })
    .onConflictDoUpdate({
      target: [
        schema.mrrSnapshots.workspaceId,
        schema.mrrSnapshots.grain,
        schema.mrrSnapshots.period,
      ],
      set: {
        mrr,
        subscriberCount,
        source: REVENUECAT_SOURCE,
      },
    });
}

function backfillEventType(status: PersonStatus): SubEventType {
  return status === "churned" ? "churned" : "new";
}

async function applySubscription(
  workspaceId: string,
  sub: RevenueCatSubscription
): Promise<boolean> {
  const personId = personIdFromCustomer(sub.customer_id);
  if (!personId || !sub.id) return false;

  const status = personStatus(sub.status, sub.gives_access);
  const mrr = subscriptionMrr(sub);
  const plan = planName(sub);
  const ltv = sub.total_revenue_in_usd?.gross ?? 0;
  const currency = (sub.total_revenue_in_usd?.currency || "usd").toLowerCase();
  const firstPaidAt =
    status === "trial" || status === "free" ? null : msToDate(sub.starts_at);
  const paidAt = msToDate(sub.current_period_starts_at) ?? msToDate(sub.starts_at);
  const eventType = backfillEventType(status);
  const occurredAt =
    status === "churned"
      ? msToDate(sub.ends_at) ?? paidAt ?? new Date()
      : paidAt ?? new Date();

  await upsertPersonRevenue({
    personId,
    accountId: personId,
    status,
    plan,
    mrr,
    ltv,
    firstPaidAt,
    lastChargeAt: status === "trial" || status === "free" ? null : paidAt,
    chargeCount: ltv > 0 ? 1 : 0,
    lastChargeAmount: status === "active" ? mrr : ltv > 0 ? ltv : null,
    currency,
    workspaceId,
  });

  return insertSubscriptionEvent({
    personId,
    accountId: personId,
    eventType,
    occurredAt,
    mrrDelta: status === "churned" ? -mrr : contributingMrr(status, mrr),
    plan,
    sourceEventId: `sub:${sub.id}:${eventType}`,
    workspaceId,
  });
}

export async function syncRevenueCat(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials(REVENUECAT_SOURCE, opts?.config);
  const apiKey = credentials.apiKey || credentials.secretKey;
  if (!apiKey) {
    throw new Error("RevenueCat secret key is required");
  }

  let projectId: string | undefined = credentials.projectId;
  if (!projectId) {
    const response = await fetch(projectsUrl(), { headers: authHeaders(apiKey) });
    if (!response.ok) {
      return failedSync({
        source: REVENUECAT_SOURCE,
        sourceName: REVENUECAT_NAME,
        workspaceId,
        status: response.status,
      });
    }
    const page = (await response.json()) as RevenueCatList<{ id?: string }>;
    projectId = page.items?.[0]?.id;
  }
  if (!projectId) {
    throw new Error("RevenueCat project id is required");
  }

  let rowsSynced = 0;
  let cursor = opts?.cursor;
  let pages = 0;
  let lastId: string | null = null;

  try {
    while (pages < REVENUECAT_MAX_PAGES) {
      const response = await fetch(customersUrl(projectId, cursor), {
        headers: authHeaders(apiKey),
      });

      if (!response.ok) {
        if (rowsSynced > 0 && response.status === 429 && lastId) {
          await refreshRevenueCatMrrSnapshot(workspaceId);
          await upsertSyncState({
            source: REVENUECAT_SOURCE,
            sourceName: REVENUECAT_NAME,
            lastSync: new Date(),
            status: "success",
            workspaceId,
          });
          return { rowsSynced, nextCursor: lastId, health: "ok" };
        }
        return failedSync({
          source: REVENUECAT_SOURCE,
          sourceName: REVENUECAT_NAME,
          workspaceId,
          status: response.status,
          rowsSynced,
        });
      }

      const page = (await response.json()) as RevenueCatList<RevenueCatCustomer>;
      const customers = page.items ?? [];
      pages += 1;

      for (const customer of customers) {
        if (!customer.id) continue;
        const subsResponse = await fetch(subscriptionsUrl(projectId, customer.id), {
          headers: authHeaders(apiKey),
        });

        if (!subsResponse.ok) {
          if (rowsSynced > 0 && subsResponse.status === 429) {
            await refreshRevenueCatMrrSnapshot(workspaceId);
            await upsertSyncState({
              source: REVENUECAT_SOURCE,
              sourceName: REVENUECAT_NAME,
              lastSync: new Date(),
              status: "success",
              workspaceId,
            });
            return { rowsSynced, nextCursor: lastId ?? customer.id, health: "ok" };
          }
          return failedSync({
            source: REVENUECAT_SOURCE,
            sourceName: REVENUECAT_NAME,
            workspaceId,
            status: subsResponse.status,
            rowsSynced,
          });
        }

        const subsPage = (await subsResponse.json()) as RevenueCatList<RevenueCatSubscription>;
        for (const sub of subsPage.items ?? []) {
          if (!sub.customer_id) sub.customer_id = customer.id;
          await applySubscription(workspaceId, sub);
          rowsSynced += 1;
        }
        lastId = customer.id;
      }

      if (!page.next_page || customers.length === 0) {
        await refreshRevenueCatMrrSnapshot(workspaceId);
        await upsertSyncState({
          source: REVENUECAT_SOURCE,
          sourceName: REVENUECAT_NAME,
          lastSync: new Date(),
          status: "success",
          workspaceId,
        });
        return { rowsSynced, nextCursor: null, health: "ok" };
      }

      cursor = lastId ?? undefined;
      if (opts?.cursor !== undefined) {
        await refreshRevenueCatMrrSnapshot(workspaceId);
        await upsertSyncState({
          source: REVENUECAT_SOURCE,
          sourceName: REVENUECAT_NAME,
          lastSync: new Date(),
          status: "success",
          workspaceId,
        });
        return { rowsSynced, nextCursor: lastId, health: "ok" };
      }
    }

    await refreshRevenueCatMrrSnapshot(workspaceId);
    await upsertSyncState({
      source: REVENUECAT_SOURCE,
      sourceName: REVENUECAT_NAME,
      lastSync: new Date(),
      status: "success",
      workspaceId,
    });
    return { rowsSynced, nextCursor: lastId, health: "ok" };
  } catch (error) {
    await upsertSyncState({
      source: REVENUECAT_SOURCE,
      sourceName: REVENUECAT_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });
    throw error;
  }
}
