/**
 * In-process connector refresh. Started once from `instrumentation.ts`
 * `register()` — the sanctioned process-lifetime hook in a Next
 * standalone server. A route-module `setInterval` would duplicate per
 * worker and leak on dev reload.
 *
 * Every run goes through `sync()` so scheduled and manual triggers
 * share ANY-16's in-process coalesce lock.
 */

import { envFallback } from "@/connectors/credentials";
import { listConnectors, sync } from "@/connectors";
import { db } from "@/core/db";
import * as schema from "@/core/schema";

export const DEFAULT_SYNC_INTERVAL_MINUTES = 15;

/** Empty cursor: incremental sources start from the beginning (nightly). */
export const FULL_PASS_CURSOR = "";

export type ScheduledSyncFn = (
  source: string,
  workspaceId: string,
  opts?: { cursor?: string }
) => Promise<unknown>;

export type ScheduledTarget = {
  workspaceId: string;
  source: string;
};

export type ScheduledRefreshHandle = {
  stop(): void;
  runOnce(opts?: { full?: boolean }): Promise<void>;
};

type SchedulerState = {
  timer: ReturnType<typeof setInterval> | null;
  immediate: ReturnType<typeof setTimeout> | null;
  inflight: Promise<void> | null;
  lastNightlyKey: string | null;
};

const globalForScheduler = globalThis as typeof globalThis & {
  __anykpiScheduledRefresh?: SchedulerState;
};

export function parseSyncIntervalMinutes(
  raw: string | undefined = process.env.SYNC_INTERVAL_MINUTES
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SYNC_INTERVAL_MINUTES;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_SYNC_INTERVAL_MINUTES;
  }
  return n;
}

export function shouldStartScheduler(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NEXT_RUNTIME === "edge") return false;
  if (env.NEXT_PHASE === "phase-production-build") return false;
  return parseSyncIntervalMinutes(env.SYNC_INTERVAL_MINUTES) > 0;
}

export function nightlyKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isNightlyPass(lastNightlyKey: string | null, now: Date): boolean {
  return lastNightlyKey !== nightlyKey(now);
}

/**
 * Workspaces with stored pull-connector config, plus `live` sources that
 * still have the deprecated env-var fallback. CSV mapping is not a pull.
 */
export async function listScheduledTargets(): Promise<ScheduledTarget[]> {
  const pullSources = new Set(listConnectors().map((connector) => connector.source));
  const seen = new Set<string>();
  const targets: ScheduledTarget[] = [];

  const add = (workspaceId: string, source: string) => {
    if (!pullSources.has(source)) return;
    const key = `${workspaceId}::${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ workspaceId, source });
  };

  const rows = await db
    .select({
      workspaceId: schema.sources.workspaceId,
      source: schema.sources.source,
    })
    .from(schema.sources)
    .all();

  for (const row of rows) {
    add(row.workspaceId, row.source);
  }

  for (const connector of listConnectors()) {
    if (Object.keys(envFallback(connector.source)).length > 0) {
      add("live", connector.source);
    }
  }

  return targets;
}

export async function runScheduledPass(opts?: {
  full?: boolean;
  syncFn?: ScheduledSyncFn;
  workspaceId?: string;
}): Promise<void> {
  const syncFn = opts?.syncFn ?? sync;
  const syncOpts = opts?.full ? { cursor: FULL_PASS_CURSOR } : undefined;
  const targets = (await listScheduledTargets()).filter((target) =>
    opts?.workspaceId ? target.workspaceId === opts.workspaceId : true
  );
  await Promise.all(
    targets.map(async ({ workspaceId, source }) => {
      try {
        await syncFn(source, workspaceId, syncOpts);
      } catch {
        // `sync()` already marks the source error. Never throw out of the timer.
      }
    })
  );
}

export function stopScheduledRefresh(): void {
  const state = globalForScheduler.__anykpiScheduledRefresh;
  if (!state) return;
  if (state.timer) clearInterval(state.timer);
  if (state.immediate) clearTimeout(state.immediate);
  state.timer = null;
  state.immediate = null;
  delete globalForScheduler.__anykpiScheduledRefresh;
}

export function startScheduledRefresh(options?: {
  intervalMinutes?: number;
  now?: () => Date;
  syncFn?: ScheduledSyncFn;
  workspaceId?: string;
}): ScheduledRefreshHandle | null {
  const intervalMinutes =
    options?.intervalMinutes ?? parseSyncIntervalMinutes();
  if (intervalMinutes === 0) {
    stopScheduledRefresh();
    return null;
  }

  stopScheduledRefresh();

  const intervalMs = Math.max(1, Math.round(intervalMinutes * 60_000));
  const state: SchedulerState = {
    timer: null,
    immediate: null,
    inflight: null,
    lastNightlyKey: null,
  };
  globalForScheduler.__anykpiScheduledRefresh = state;

  const clock = options?.now ?? (() => new Date());

  const tick = (): void => {
    if (state.inflight) return;
    const now = clock();
    const full = isNightlyPass(state.lastNightlyKey, now);
    state.inflight = runScheduledPass({
      full,
      syncFn: options?.syncFn,
      workspaceId: options?.workspaceId,
    })
      .then(() => {
        if (full) state.lastNightlyKey = nightlyKey(now);
      })
      .finally(() => {
        state.inflight = null;
      });
  };

  state.immediate = setTimeout(() => {
    tick();
  }, 0);
  state.timer = setInterval(() => {
    tick();
  }, intervalMs);

  return {
    stop: stopScheduledRefresh,
    runOnce: (opts) =>
      runScheduledPass({
        full: opts?.full,
        syncFn: options?.syncFn,
        workspaceId: options?.workspaceId,
      }),
  };
}
