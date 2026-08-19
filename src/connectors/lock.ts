/**
 * In-process coalesce lock for connector runs.
 *
 * Concurrent triggers for the same (workspace, source) share one in-flight
 * promise. The first caller owns the run; later callers await the same result.
 * Owned by the registry — do not take this lock in route handlers.
 */

const inflight = new Map<string, Promise<unknown>>();

export function sourceLockKey(workspaceId: string, source: string): string {
  return `${workspaceId}::${source}`;
}

export function withSourceLock<T>(
  workspaceId: string,
  source: string,
  run: () => Promise<T>
): Promise<T> {
  const key = sourceLockKey(workspaceId, source);
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const created = run().finally(() => {
    if (inflight.get(key) === created) {
      inflight.delete(key);
    }
  });
  inflight.set(key, created);
  return created;
}
