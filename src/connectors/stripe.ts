/**
 * Stripe connector — subscription backfill plus live webhook apply.
 *
 * Restricted read-only key via the sources store (ANY-46). Never logs
 * credentials or webhook secrets. Writes ANY-45 revenue tables only.
 *
 * Backfill lists subscriptions, one page at a time when a cursor is
 * supplied, otherwise paginates to completion. `nextCursor` is the
 * Stripe `starting_after` id when more pages remain.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { and, eq } from "drizzle-orm";
import type { SyncResult } from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertSyncState } from "@/core/upsert";
import { resolveCredentials } from "./credentials";
import { failedSync } from "./http-status";
import type { SyncOpts } from "./types";

export const STRIPE_SOURCE = "stripe";
export const STRIPE_NAME = "Stripe";
export const STRIPE_API = "https://api.stripe.com/v1";
export const STRIPE_PAGE_SIZE = 100;
export const STRIPE_MAX_PAGES = 50;
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300;

export type StripeRecurring = {
  interval?: string | null;
  interval_count?: number | null;
};

export type StripePrice = {
  id?: string;
  unit_amount?: number | null;
  currency?: string | null;
  nickname?: string | null;
  recurring?: StripeRecurring | null;
};

export type StripeSubscriptionItem = {
  id?: string;
  quantity?: number | null;
  price?: StripePrice | null;
};

export type StripeSubscription = {
  id: string;
  customer?: string | { id?: string } | null;
  status?: string | null;
  created?: number | null;
  start_date?: number | null;
  canceled_at?: number | null;
  currency?: string | null;
  items?: { data?: StripeSubscriptionItem[] } | null;
};

export type StripeInvoice = {
  id?: string;
  customer?: string | { id?: string } | null;
  amount_paid?: number | null;
  currency?: string | null;
  created?: number | null;
  status?: string | null;
};

export type StripeEvent = {
  id?: string;
  type?: string;
  created?: number;
  data?: {
    object?: StripeSubscription | StripeInvoice | Record<string, unknown>;
    previous_attributes?: Record<string, unknown>;
  };
};

type PersonStatus = "active" | "churned" | "trial" | "free";
type SubEventType = "new" | "churned" | "renewed" | "upgraded" | "downgraded";

function customerId(value: string | { id?: string } | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id ?? null;
}

export function personIdFromCustomer(
  customer: string | { id?: string } | null | undefined
): string | null {
  return customerId(customer);
}

export function subscriptionMrr(sub: StripeSubscription): number {
  const items = sub.items?.data ?? [];
  let cents = 0;
  for (const item of items) {
    const amount = item.price?.unit_amount ?? 0;
    const qty = item.quantity ?? 1;
    const interval = item.price?.recurring?.interval ?? "month";
    const count = item.price?.recurring?.interval_count ?? 1;
    cents += monthlyCents(amount, interval, count) * qty;
  }
  return Math.round(cents) / 100;
}

function monthlyCents(unitAmount: number, interval: string, intervalCount: number): number {
  const count = intervalCount > 0 ? intervalCount : 1;
  switch (interval) {
    case "day":
      return (unitAmount * 30) / count;
    case "week":
      return (unitAmount * 52) / 12 / count;
    case "year":
      return unitAmount / 12 / count;
    case "month":
    default:
      return unitAmount / count;
  }
}

export function planName(sub: StripeSubscription): string | null {
  const price = sub.items?.data?.[0]?.price;
  return price?.nickname || price?.id || null;
}

export function personStatus(status: string | null | undefined): PersonStatus {
  switch (status) {
    case "active":
    case "past_due":
      return "active";
    case "trialing":
      return "trial";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "churned";
    default:
      return "free";
  }
}

function contributingMrr(status: PersonStatus, mrr: number): number {
  return status === "active" ? mrr : 0;
}

export function utcWeekStart(at: Date = new Date()): Date {
  const utc = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc;
}

function unixToDate(seconds: number | null | undefined): Date | null {
  if (!seconds || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

function webhookSecretBytes(secret: string): Buffer {
  if (secret.startsWith("whsec_")) {
    return Buffer.from(secret.slice(6), "base64");
  }
  return Buffer.from(secret, "utf8");
}

export function computeStripeSignature(
  payload: string,
  timestamp: number,
  secret: string
): string {
  return createHmac("sha256", webhookSecretBytes(secret))
    .update(`${timestamp}.${payload}`, "utf8")
    .digest("hex");
}

export function parseStripeSignatureHeader(
  header: string
): { timestamp: number; signatures: string[] } | null {
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const sep = part.indexOf("=");
    if (sep <= 0) continue;
    const key = part.slice(0, sep).trim();
    const value = part.slice(sep + 1).trim();
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function timingSafeEqualHex(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, "hex");
    const b = Buffer.from(right, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyStripeSignature(opts: {
  payload: string;
  header: string;
  secret: string;
  nowSec?: number;
  toleranceSec?: number;
}): boolean {
  const parsed = parseStripeSignatureHeader(opts.header);
  if (!parsed) return false;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSec ?? STRIPE_SIGNATURE_TOLERANCE_SEC;
  if (Math.abs(now - parsed.timestamp) > tolerance) return false;
  const expected = computeStripeSignature(opts.payload, parsed.timestamp, opts.secret);
  return parsed.signatures.some((signature) => timingSafeEqualHex(signature, expected));
}

export function resolveStripeWebhookSecret(
  config?: Record<string, string>
): string | undefined {
  return config?.webhookSecret || config?.secretKey;
}

function subscriptionsUrl(cursor?: string): string {
  const url = new URL(`${STRIPE_API}/subscriptions`);
  url.searchParams.set("limit", String(STRIPE_PAGE_SIZE));
  url.searchParams.set("status", "all");
  if (cursor) url.searchParams.set("starting_after", cursor);
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
      source: STRIPE_SOURCE,
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
        source: STRIPE_SOURCE,
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
  await db
    .insert(schema.subscriptionEvents)
    .values({
      personId: row.personId,
      accountId: row.accountId,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      mrrDelta: row.mrrDelta,
      plan: row.plan,
      source: STRIPE_SOURCE,
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

export async function refreshStripeMrrSnapshot(workspaceId: string): Promise<void> {
  const people = await db
    .select()
    .from(schema.personRevenue)
    .where(
      and(
        eq(schema.personRevenue.workspaceId, workspaceId),
        eq(schema.personRevenue.source, STRIPE_SOURCE)
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
      source: STRIPE_SOURCE,
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
        source: STRIPE_SOURCE,
      },
    });
}

async function applySubscription(
  workspaceId: string,
  sub: StripeSubscription,
  opts: {
    sourceEventId: string;
    eventType: SubEventType;
    occurredAt: Date;
    mrrDelta: number;
  }
): Promise<boolean> {
  const personId = personIdFromCustomer(sub.customer);
  if (!personId || !sub.id) return false;

  const status = personStatus(sub.status);
  const mrr = subscriptionMrr(sub);
  const plan = planName(sub);
  const currency = sub.items?.data?.[0]?.price?.currency || sub.currency || "usd";
  const firstPaidAt =
    status === "trial" || status === "free"
      ? null
      : unixToDate(sub.start_date ?? sub.created);

  await upsertPersonRevenue({
    personId,
    accountId: personId,
    status,
    plan,
    mrr,
    firstPaidAt,
    currency,
    workspaceId,
  });

  return insertSubscriptionEvent({
    personId,
    accountId: personId,
    eventType: opts.eventType,
    occurredAt: opts.occurredAt,
    mrrDelta: opts.mrrDelta,
    plan,
    sourceEventId: opts.sourceEventId,
    workspaceId,
  });
}

function backfillEventType(status: PersonStatus): SubEventType {
  return status === "churned" ? "churned" : "new";
}

function changeEventType(
  sub: StripeSubscription,
  previous?: Record<string, unknown>
): { eventType: SubEventType; mrrDelta: number } {
  const nextStatus = personStatus(sub.status);
  const nextMrr = contributingMrr(nextStatus, subscriptionMrr(sub));
  const prevStatus = personStatus(
    typeof previous?.status === "string" ? previous.status : sub.status
  );
  let prevMrr = nextMrr;
  if (previous?.items && typeof previous.items === "object") {
    prevMrr = contributingMrr(
      prevStatus,
      subscriptionMrr({
        id: sub.id,
        items: previous.items as StripeSubscription["items"],
      })
    );
  } else if (prevStatus !== "active") {
    prevMrr = 0;
  }

  if (nextStatus === "churned" && prevStatus !== "churned") {
    return { eventType: "churned", mrrDelta: -prevMrr || -nextMrr };
  }
  if (prevStatus !== "active" && nextStatus === "active") {
    return { eventType: "new", mrrDelta: nextMrr };
  }
  if (nextMrr > prevMrr) return { eventType: "upgraded", mrrDelta: nextMrr - prevMrr };
  if (nextMrr < prevMrr) return { eventType: "downgraded", mrrDelta: nextMrr - prevMrr };
  return { eventType: "renewed", mrrDelta: 0 };
}

async function applyInvoice(workspaceId: string, invoice: StripeInvoice): Promise<boolean> {
  const personId = personIdFromCustomer(invoice.customer);
  if (!personId) return false;
  const paid = (invoice.amount_paid ?? 0) / 100;
  const at = unixToDate(invoice.created) ?? new Date();
  const existing = await db
    .select()
    .from(schema.personRevenue)
    .where(
      and(
        eq(schema.personRevenue.workspaceId, workspaceId),
        eq(schema.personRevenue.personId, personId)
      )
    )
    .get();

  await upsertPersonRevenue({
    personId,
    accountId: existing?.accountId ?? personId,
    status: (existing?.status as PersonStatus) || "active",
    plan: existing?.plan ?? null,
    mrr: existing?.mrr ?? 0,
    ltv: (existing?.ltv ?? 0) + paid,
    firstPaidAt: existing?.firstPaidAt ?? at,
    lastChargeAt: at,
    chargeCount: (existing?.chargeCount ?? 0) + 1,
    lastChargeAmount: paid,
    currency: invoice.currency || existing?.currency || "usd",
    workspaceId,
  });

  return true;
}

/**
 * Apply one verified Stripe event to the revenue read models.
 * Does not call the Stripe API (no poll).
 */
export async function applyStripeWebhookEvent(
  workspaceId: string,
  event: StripeEvent
): Promise<boolean> {
  const type = event.type;
  const object = event.data?.object;
  if (!type || !object) return false;

  const occurredAt = unixToDate(event.created) ?? new Date();
  const sourceEventId = event.id ? `evt:${event.id}` : `evt:${type}:${occurredAt.toISOString()}`;

  if (
    type === "customer.subscription.created" ||
    type === "customer.subscription.updated" ||
    type === "customer.subscription.deleted"
  ) {
    const sub = object as StripeSubscription;
    const change =
      type === "customer.subscription.deleted"
        ? { eventType: "churned" as const, mrrDelta: -subscriptionMrr(sub) }
        : type === "customer.subscription.created"
          ? {
              eventType: "new" as const,
              mrrDelta: contributingMrr(personStatus(sub.status), subscriptionMrr(sub)),
            }
          : changeEventType(sub, event.data?.previous_attributes);

    if (type === "customer.subscription.deleted") {
      sub.status = "canceled";
    }

    const wrote = await applySubscription(workspaceId, sub, {
      sourceEventId,
      eventType: change.eventType,
      occurredAt,
      mrrDelta: change.mrrDelta,
    });
    await refreshStripeMrrSnapshot(workspaceId);
    return wrote;
  }

  if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    const wrote = await applyInvoice(workspaceId, object as StripeInvoice);
    await refreshStripeMrrSnapshot(workspaceId);
    return wrote;
  }

  return false;
}

export async function syncStripe(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials(STRIPE_SOURCE, opts?.config);
  const apiKey = credentials.apiKey;
  if (!apiKey) {
    throw new Error("Stripe restricted key is required");
  }

  let rowsSynced = 0;
  let cursor = opts?.cursor;
  let pages = 0;
  let lastId: string | null = null;

  try {
    while (pages < STRIPE_MAX_PAGES) {
      const response = await fetch(subscriptionsUrl(cursor), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        if (rowsSynced > 0 && response.status === 429 && lastId) {
          await refreshStripeMrrSnapshot(workspaceId);
          await upsertSyncState({
            source: STRIPE_SOURCE,
            sourceName: STRIPE_NAME,
            lastSync: new Date(),
            status: "success",
            workspaceId,
          });
          return { rowsSynced, nextCursor: lastId, health: "ok" };
        }
        return failedSync({
          source: STRIPE_SOURCE,
          sourceName: STRIPE_NAME,
          workspaceId,
          status: response.status,
          rowsSynced,
        });
      }

      const page = (await response.json()) as {
        data?: StripeSubscription[];
        has_more?: boolean;
      };
      const data = page.data ?? [];
      pages += 1;

      for (const sub of data) {
        const status = personStatus(sub.status);
        const mrr = contributingMrr(status, subscriptionMrr(sub));
        const occurredAt =
          unixToDate(sub.canceled_at) ??
          unixToDate(sub.start_date ?? sub.created) ??
          new Date();
        await applySubscription(workspaceId, sub, {
          sourceEventId: `sub:${sub.id}:${backfillEventType(status)}`,
          eventType: backfillEventType(status),
          occurredAt,
          mrrDelta: status === "churned" ? -mrr : mrr,
        });
        rowsSynced += 1;
        lastId = sub.id;
      }

      if (!page.has_more || data.length === 0) {
        await refreshStripeMrrSnapshot(workspaceId);
        await upsertSyncState({
          source: STRIPE_SOURCE,
          sourceName: STRIPE_NAME,
          lastSync: new Date(),
          status: "success",
          workspaceId,
        });
        return { rowsSynced, nextCursor: null, health: "ok" };
      }

      cursor = lastId ?? undefined;
      if (opts?.cursor !== undefined) {
        await refreshStripeMrrSnapshot(workspaceId);
        await upsertSyncState({
          source: STRIPE_SOURCE,
          sourceName: STRIPE_NAME,
          lastSync: new Date(),
          status: "success",
          workspaceId,
        });
        return { rowsSynced, nextCursor: lastId, health: "ok" };
      }
    }

    await refreshStripeMrrSnapshot(workspaceId);
    await upsertSyncState({
      source: STRIPE_SOURCE,
      sourceName: STRIPE_NAME,
      lastSync: new Date(),
      status: "success",
      workspaceId,
    });
    return { rowsSynced, nextCursor: lastId, health: "ok" };
  } catch (error) {
    await upsertSyncState({
      source: STRIPE_SOURCE,
      sourceName: STRIPE_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });
    throw error;
  }
}
