/**
 * User hover-card helpers — ported from the design of record
 * (spec/prototype.html, .ucard). Pure functions so the personality
 * note and the spark strip stay unit-testable.
 */

/** One-line personality read per behavior cluster — the card's italic note. */
const CLUSTER_NOTES: Record<string, string> = {
  "🔥 Power daily": "power user — basically lives here",
  "💼 Weekday workers": "strictly business hours",
  "🌴 Weekenders": "weekend warrior",
  "🌙 Occasional": "drops by when the mood hits",
  "🗓️ Monthly check-ins": "monthly check-in energy",
  "⚡ Bursty": "binges, then vanishes, then binges",
  "🫥 Fading away": "gone quiet — send a nudge?",
  "🐣 Brand new": "brand new — be nice",
};

export function clusterNote(cluster: string | null): string | null {
  if (!cluster) return null;
  return CLUSTER_NOTES[cluster] ?? null;
}

/** The trailing window of the activity timeline shown as the spark strip. */
export const STRIP_DAYS = 56;

export function stripDays(activity: boolean[]): boolean[] {
  return activity.slice(-STRIP_DAYS);
}

/** Card box metrics used to clamp position inside the viewport. */
export const CARD_W = 250;
export const CARD_H = 190;

export function clampCardPosition(
  anchor: { left: number; bottom: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: Math.min(anchor.left + 40, viewport.width - (CARD_W + 20)),
    y: Math.min(anchor.bottom + 6, viewport.height - CARD_H),
  };
}
