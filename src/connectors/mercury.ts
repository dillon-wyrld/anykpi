/**
 * Banking connector — read-only balance summaries into the ANY-45
 * runway read model. Token via the sources store (ANY-46). Never logs
 * credentials. Writes `balance_snapshots` only.
 */

import type { SyncResult } from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertSyncState } from "@/core/upsert";
import { resolveCredentials } from "./credentials";
import { failedSync } from "./http-status";
import type { SyncOpts } from "./types";

export const MERCURY_SOURCE = "mercury";
export const MERCURY_NAME = "Mercury";
export const MERCURY_API = "https://api.mercury.com/api/v1";
export const MERCURY_PAGE_SIZE = 1000;
export const MERCURY_MAX_PAGES = 50;
/** Trailing window used to annualize burn into a monthly rate. */
export const TRAILING_DAYS = 90;
export const MONTH_DAYS = 30;

export type MercuryAccount = {
  id: string;
  name?: string | null;
  nickname?: string | null;
  status?: string | null;
  type?: string | null;
  kind?: string | null;
  currentBalance?: number | null;
  availableBalance?: number | null;
};

export type MercuryTransaction = {
  id?: string;
  amount: number;
  status?: string | null;
  kind?: string | null;
  createdAt?: string | null;
  postedAt?: string | null;
  accountId?: string | null;
};

export type MercuryAccountsResponse = {
  accounts?: MercuryAccount[];
  data?: MercuryAccount[];
  page?: { nextPage?: string | null };
};

export type MercuryTransactionsResponse = {
  total?: number;
  transactions?: MercuryTransaction[];
  data?: MercuryTransaction[];
};

export type BalanceSummary = {
  asOf: Date;
  cashBalance: number;
  monthlyBurn: number;
  runwayMonths: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function utcWeekStart(at: Date = new Date()): Date {
  const utc = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const day = utc.getUTCDay();
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc;
}

export function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function isCashAccount(account: MercuryAccount): boolean {
  if (account.status && account.status !== "active") return false;
  if (account.type && account.type !== "mercury") return false;
  const kind = (account.kind ?? "").toLowerCase();
  if (kind.includes("credit")) return false;
  return true;
}

export function cashBalance(accounts: MercuryAccount[]): number {
  return round2(
    accounts
      .filter(isCashAccount)
      .reduce((sum, account) => sum + (account.currentBalance ?? 0), 0)
  );
}

export function isInternalTransfer(tx: MercuryTransaction): boolean {
  return tx.kind === "internalTransfer" || tx.kind === "treasuryTransfer";
}

export function countsTowardBurn(tx: MercuryTransaction): boolean {
  if (tx.status && tx.status !== "sent") return false;
  return !isInternalTransfer(tx);
}

/**
 * Monthly burn from a trailing window of posted, non-internal transactions.
 * The array is the window (the connector fetches the last `trailingDays`).
 * Cash-flow positive windows are 0 — same as the WBR runway helper.
 */
export function trailingMonthlyBurn(
  transactions: MercuryTransaction[],
  trailingDays: number = TRAILING_DAYS
): number {
  const days = trailingDays > 0 ? trailingDays : TRAILING_DAYS;
  const net = transactions
    .filter(countsTowardBurn)
    .reduce((sum, tx) => sum + tx.amount, 0);
  if (net >= 0) return 0;
  return round2((-net * MONTH_DAYS) / days);
}

export function runwayMonths(cash: number, monthlyBurn: number): number {
  if (monthlyBurn <= 0) return 0;
  return round2(cash / monthlyBurn);
}

export function summarizeBalance(
  accounts: MercuryAccount[],
  transactions: MercuryTransaction[],
  asOf: Date = new Date(),
  trailingDays: number = TRAILING_DAYS
): BalanceSummary {
  const cash = cashBalance(accounts);
  const burn = trailingMonthlyBurn(transactions, trailingDays);
  return {
    asOf: utcWeekStart(asOf),
    cashBalance: cash,
    monthlyBurn: burn,
    runwayMonths: runwayMonths(cash, burn),
  };
}

function accountsFrom(body: MercuryAccountsResponse): MercuryAccount[] {
  return body.accounts ?? body.data ?? [];
}

function transactionsFrom(body: MercuryTransactionsResponse): MercuryTransaction[] {
  return body.transactions ?? body.data ?? [];
}

function accountsUrl(cursor?: string): string {
  const url = new URL(`${MERCURY_API}/accounts`);
  url.searchParams.set("limit", String(MERCURY_PAGE_SIZE));
  if (cursor) url.searchParams.set("start_after", cursor);
  return url.toString();
}

function transactionsUrl(accountId: string, start: Date, end: Date, offset: number): string {
  const url = new URL(`${MERCURY_API}/account/${accountId}/transactions`);
  url.searchParams.set("limit", String(MERCURY_PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("start", isoDate(start));
  url.searchParams.set("end", isoDate(end));
  url.searchParams.set("status", "sent");
  return url.toString();
}

async function mercuryGet<T>(
  url: string,
  token: string
): Promise<{ ok: true; body: T } | { ok: false; status: number }> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  return { ok: true, body: (await response.json()) as T };
}

async function persistSnapshot(workspaceId: string, summary: BalanceSummary): Promise<void> {
  await db
    .insert(schema.balanceSnapshots)
    .values({
      asOf: summary.asOf,
      cashBalance: summary.cashBalance,
      monthlyBurn: summary.monthlyBurn,
      runwayMonths: summary.runwayMonths,
      source: MERCURY_SOURCE,
      workspaceId,
    })
    .onConflictDoUpdate({
      target: [schema.balanceSnapshots.workspaceId, schema.balanceSnapshots.asOf],
      set: {
        cashBalance: summary.cashBalance,
        monthlyBurn: summary.monthlyBurn,
        runwayMonths: summary.runwayMonths,
        source: MERCURY_SOURCE,
      },
    });
}

export async function syncMercury(
  workspaceId: string = "live",
  opts?: SyncOpts
): Promise<SyncResult> {
  const credentials = resolveCredentials(MERCURY_SOURCE, opts?.config);
  const token = credentials.apiKey || credentials.token;
  if (!token) {
    throw new Error("Mercury API token is required");
  }

  const now = new Date();
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - TRAILING_DAYS * 86400000);

  try {
    const accounts: MercuryAccount[] = [];
    let accountCursor = opts?.cursor;
    let accountPages = 0;

    while (accountPages < MERCURY_MAX_PAGES) {
      const page = await mercuryGet<MercuryAccountsResponse>(
        accountsUrl(accountCursor),
        token
      );
      if (!page.ok) {
        return failedSync({
          source: MERCURY_SOURCE,
          sourceName: MERCURY_NAME,
          workspaceId,
          status: page.status,
        });
      }

      const rows = accountsFrom(page.body);
      accounts.push(...rows);
      accountPages += 1;

      const next = page.body.page?.nextPage;
      if (!next || rows.length === 0) break;
      accountCursor = next;
      if (opts?.cursor !== undefined) break;
    }

    const cashAccounts = accounts.filter(isCashAccount);
    const transactions: MercuryTransaction[] = [];

    for (const account of cashAccounts) {
      let offset = 0;
      let pages = 0;
      while (pages < MERCURY_MAX_PAGES) {
        const page = await mercuryGet<MercuryTransactionsResponse>(
          transactionsUrl(account.id, windowStart, windowEnd, offset),
          token
        );
        if (!page.ok) {
          return failedSync({
            source: MERCURY_SOURCE,
            sourceName: MERCURY_NAME,
            workspaceId,
            status: page.status,
          });
        }

        const rows = transactionsFrom(page.body);
        transactions.push(...rows);
        pages += 1;
        offset += rows.length;

        const total = page.body.total;
        if (rows.length === 0) break;
        if (total !== undefined && offset >= total) break;
        if (rows.length < MERCURY_PAGE_SIZE) break;
      }
    }

    const summary = summarizeBalance(accounts, transactions, now);
    await persistSnapshot(workspaceId, summary);

    await upsertSyncState({
      source: MERCURY_SOURCE,
      sourceName: MERCURY_NAME,
      lastSync: now,
      status: "success",
      workspaceId,
    });

    return { rowsSynced: 1, nextCursor: null, health: "ok" };
  } catch (error) {
    await upsertSyncState({
      source: MERCURY_SOURCE,
      sourceName: MERCURY_NAME,
      lastSync: new Date(),
      status: "error",
      error: "sync failed",
      workspaceId,
    });
    throw error;
  }
}
