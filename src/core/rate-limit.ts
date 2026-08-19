/**
 * Minimal in-process fixed-window rate limiter for the write endpoints.
 *
 * Deliberately simple for a self-hosted single-instance deployment: it bounds
 * flooding / disk-growth without adding infrastructure. Swap for a shared store
 * if ANYKPI ever runs multi-instance.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 600; // requests per minute per client key

function prune(now: number) {
  if (windows.size < 10_000) return;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
}

export function rateLimit(
  clientKey: string,
  limit = DEFAULT_LIMIT
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  prune(now);

  const current = windows.get(clientKey);
  if (!current || current.resetAt <= now) {
    windows.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Best-effort client identity from proxy headers. */
export function clientKeyFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "local";
}
