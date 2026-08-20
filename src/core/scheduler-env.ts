/**
 * Env parsing for scheduled refresh. Kept free of SQLite so
 * `instrumentation.ts` can decide whether to start without pulling
 * better-sqlite3 into the Edge webpack graph (PR #41 owns those stubs).
 */

export const DEFAULT_SYNC_INTERVAL_MINUTES = 15;

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
