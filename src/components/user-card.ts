/**
 * Pure helpers for the dot-plot user hover card (spec/prototype.html `.ucard`).
 */

const CLUSTER_NOTES: Record<string, string> = {
  daily: "power user — basically lives here",
  weekday: "strictly business hours",
  weekender: "weekend warrior",
  casual: "drops by when the mood hits",
  monthly: "monthly check-in energy",
  burst: "binges, then vanishes, then binges",
  churned: "gone quiet — send a nudge?",
  newbie: "brand new — be nice",
};

/** Seeded swimlane labels → prototype archetype id. */
const CLUSTER_LABEL_TO_ID: Record<string, string> = {
  "🔥 Power daily": "daily",
  "💼 Weekday workers": "weekday",
  "🌴 Weekenders": "weekender",
  "🌙 Occasional": "casual",
  "🗓️ Monthly check-ins": "monthly",
  "⚡ Bursty": "burst",
  "🫥 Fading away": "churned",
  "🐣 Brand new": "newbie",
};

export const STRIP_WINDOW = 56;

/** Prototype card width. Clamp uses innerWidth − 270 (20px gutter). */
export const USER_CARD_WIDTH = 250;
export const USER_CARD_RIGHT_EDGE = 270;
/** Prototype clamps top to innerHeight − 190. */
export const USER_CARD_BOTTOM_EDGE = 190;

/**
 * Personality note from the user's behavior cluster.
 * Accepts a cluster id (`weekender`) or a seeded swimlane label.
 * Missing / unknown cluster → null (render nothing).
 */
export function clusterNote(cluster: string | null | undefined): string | null {
  if (!cluster) return null;
  const key = cluster.trim();
  if (!key) return null;
  if (CLUSTER_NOTES[key]) return CLUSTER_NOTES[key];
  const id = CLUSTER_LABEL_TO_ID[key];
  return id ? CLUSTER_NOTES[id] : null;
}

/** Trailing `window` days of an activity row (prototype: `timeline.slice(DAYS-56)`). */
export function stripDays(
  activity: readonly boolean[],
  window = STRIP_WINDOW
): boolean[] {
  if (activity.length === 0) return [];
  return activity.slice(Math.max(0, activity.length - window));
}

/**
 * Keep the card inside the viewport. Preferred origin is
 * `label.left + 40`, `label.bottom + 6` — same as the prototype.
 * Both edges are clamped so a tight viewport never goes negative.
 */
export function clampCardPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, viewportWidth - USER_CARD_RIGHT_EDGE)),
    y: Math.max(0, Math.min(y, viewportHeight - USER_CARD_BOTTOM_EDGE)),
  };
}
