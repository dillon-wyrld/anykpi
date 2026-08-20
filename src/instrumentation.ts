/**
 * Next.js boot hook. Validate operator config before any view renders,
 * then start the process-lifetime sync scheduler. Invalid
 * `anykpi.config.json` throws with the offending path.
 *
 * Scheduled refresh lives here — not in a route module — so a Next
 * standalone server has one timer even across workers/reloads.
 *
 * Node-only work is gated on `NEXT_RUNTIME === "nodejs"`. Edge analysis
 * of this file is why next.config stubs Node builtins (same approach
 * as ANY-36 / PR #41 — union fallback keys on rebase).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { loadAnykpiConfig } = await import("@/core/config");
  loadAnykpiConfig();
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { shouldStartScheduler } = await import("@/core/scheduler-env");
  if (!shouldStartScheduler()) return;
  const { startScheduledRefresh } = await import("./core/scheduler");
  startScheduledRefresh();
}
