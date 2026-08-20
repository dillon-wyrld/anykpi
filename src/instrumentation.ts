/**
 * Next.js boot hook. Validate operator config before any view renders,
 * then start the process-lifetime sync scheduler. Invalid
 * `anykpi.config.json` throws with the offending path.
 *
 * Scheduled refresh lives here — not in a route module — so a Next
 * standalone server has one timer even across workers/reloads.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { loadAnykpiConfig } = await import("@/core/config");
  loadAnykpiConfig();
  const { shouldStartScheduler, startScheduledRefresh } = await import(
    "@/core/scheduler"
  );
  // Skip Edge (already returned), `next build`, and SYNC_INTERVAL_MINUTES=0.
  if (!shouldStartScheduler()) return;
  startScheduledRefresh();
}
