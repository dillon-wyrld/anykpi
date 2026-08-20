/**
 * Presentation for the /connect connector health panel.
 *
 * Status lives in sync_state and is already on get_overview as
 * `syncHealth`. This module turns that plus SYNC_INTERVAL_MINUTES into
 * last-sync, next-run, rows, and a human error with a next step — never
 * a status code.
 */

import type { SyncHealth } from "@/core/contracts";
import { formatSyncAge } from "@/core/views/calendar-math";

export type ConnectorHealthRow = {
  source: string;
  sourceName: string;
  status: SyncHealth["status"];
  lastSynced?: string;
  lastSyncLabel: string;
  rowsSynced?: number;
  rowsLabel: string;
  nextRunAt: string | null;
  nextRunLabel: string;
  problem?: string;
  nextStep?: string;
};

export type HumanSyncError = {
  problem: string;
  nextStep: string;
};

const GENERIC_FAILURE: HumanSyncError = {
  problem: "The last pull did not finish.",
  nextStep: "Check the source is reachable, then sync now.",
};

const UNAUTHORIZED: HumanSyncError = {
  problem: "This source rejected the credentials ANYKPI has stored.",
  nextStep: "Update the key on this page, then sync now.",
};

const RATE_LIMITED: HumanSyncError = {
  problem: "This source asked ANYKPI to wait before pulling again.",
  nextStep: "Wait a few minutes, then sync now. The next scheduled run will retry.",
};

const UPSTREAM_DOWN: HumanSyncError = {
  problem: "This source did not complete the pull.",
  nextStep: "Try sync now. If it keeps failing, check the source is up, then retry.",
};

/** Whole-string HTTP codes (`401`, `HTTP 429`) — never shown on /connect. */
export function statusCodeFromError(error: string): number | null {
  const match = error.trim().match(/^(?:http\s*)?([1-5]\d{2})$/i);
  if (!match) return null;
  return Number(match[1]);
}

export function humanizeSyncError(error?: string | null): HumanSyncError {
  if (!error || !error.trim()) return GENERIC_FAILURE;

  const normalized = error.trim().toLowerCase();
  const code = statusCodeFromError(error);

  if (
    code === 401 ||
    code === 403 ||
    normalized === "unauthorized" ||
    normalized.includes("unauthorized")
  ) {
    return UNAUTHORIZED;
  }
  if (
    code === 429 ||
    normalized === "rate limited" ||
    normalized.includes("rate limited")
  ) {
    return RATE_LIMITED;
  }
  if (code !== null && code >= 500) return UPSTREAM_DOWN;
  if (code !== null) return GENERIC_FAILURE;
  if (normalized === "sync failed" || normalized.includes("sync failed")) {
    return GENERIC_FAILURE;
  }
  return GENERIC_FAILURE;
}

export function nextRunIso(
  lastSynced: string | undefined,
  intervalMinutes: number
): string | null {
  if (intervalMinutes <= 0 || !lastSynced) return null;
  const last = Date.parse(lastSynced);
  if (!Number.isFinite(last)) return null;
  return new Date(last + intervalMinutes * 60_000).toISOString();
}

export function formatNextRunLabel(
  lastSynced: string | undefined,
  intervalMinutes: number,
  now: Date = new Date()
): string {
  if (intervalMinutes <= 0) {
    return "Scheduler off. Sync now, or POST /api/v1/sync from cron.";
  }
  if (!lastSynced) {
    return `Every ${intervalMinutes} minutes after the first run`;
  }
  const next = nextRunIso(lastSynced, intervalMinutes);
  if (!next) return `Every ${intervalMinutes} minutes`;
  const delta = Date.parse(next) - now.getTime();
  if (delta <= 0) return "Due now";
  const minutes = Math.max(1, Math.round(delta / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

export function presentConnectorHealth(
  health: SyncHealth[],
  opts: {
    intervalMinutes: number;
    now?: Date;
    rowsSynced?: Record<string, number>;
  }
): ConnectorHealthRow[] {
  const now = opts.now ?? new Date();
  return health.map((item) => {
    const last = item.lastSynced ? new Date(item.lastSynced) : null;
    const rows = opts.rowsSynced?.[item.source];
    const human =
      item.status === "error" ? humanizeSyncError(item.error) : undefined;
    return {
      source: item.source,
      sourceName: item.sourceName,
      status: item.status,
      lastSynced: item.lastSynced,
      lastSyncLabel: last ? formatSyncAge(last, now) : "Never",
      rowsSynced: rows,
      rowsLabel: rows === undefined ? "—" : String(rows),
      nextRunAt: nextRunIso(item.lastSynced, opts.intervalMinutes),
      nextRunLabel: formatNextRunLabel(
        item.lastSynced,
        opts.intervalMinutes,
        now
      ),
      problem: human?.problem,
      nextStep: human?.nextStep,
    };
  });
}

/** Map GET /api/v1/sync states onto the syncHealth shape from overview. */
export function syncStatesToHealth(
  states: Array<{
    source: string;
    sourceName: string;
    status: SyncHealth["status"];
    lastSync?: string;
    error?: string;
  }>
): SyncHealth[] {
  return states.map((state) => ({
    source: state.source,
    sourceName: state.sourceName,
    status: state.status,
    lastSynced: state.lastSync,
    error: state.error,
  }));
}
