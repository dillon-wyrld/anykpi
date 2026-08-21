/**
 * Vanity-event guard (ANY-65). Page views, app opens, session starts,
 * and logins count presence, not value. One-sentence warning; never a
 * hard block. Shared by the /connect picker and configure_value_events.
 */

export const VALUE_EVENTS_CONFIG_KEY = "value_events";

export const VALUE_EVENT_CLASSES = ["core", "search", "share", "pay"] as const;
export type ValueEventClass = (typeof VALUE_EVENT_CLASSES)[number];
export type ValueEventMapping = Partial<Record<ValueEventClass, string[]>>;

/** Same sentence on /connect and configure_value_events. */
export const VANITY_EVENT_WARNING =
  "That event is vanity — it counts presence, not value.";

const VANITY_NORMALIZED = new Set([
  "pageview",
  "page_view",
  "page_views",
  "app_open",
  "app_opened",
  "app_opens",
  "opened_the_app",
  "session_start",
  "session_started",
  "session_starts",
  "login",
  "log_in",
  "logins",
  "logged_in",
]);

export function normalizeEventName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^\$+/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isVanityEvent(name: string): boolean {
  if (!name.trim()) return false;
  return VANITY_NORMALIZED.has(normalizeEventName(name));
}

export function eventNamesFromMapping(mapping: ValueEventMapping): string[] {
  return VALUE_EVENT_CLASSES.flatMap((cls) => mapping[cls] ?? []);
}

export function vanityWarningFor(names: Iterable<string>): string | null {
  for (const name of names) {
    if (isVanityEvent(name)) return VANITY_EVENT_WARNING;
  }
  return null;
}

export function vanityWarningForMapping(
  mapping: ValueEventMapping
): string | null {
  return vanityWarningFor(eventNamesFromMapping(mapping));
}

function asNameList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseValueEventMapping(input: unknown): ValueEventMapping {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const record = input as Record<string, unknown>;
  const mapping: ValueEventMapping = {};
  for (const cls of VALUE_EVENT_CLASSES) {
    const names = asNameList(record[cls]);
    if (names.length > 0) mapping[cls] = names;
  }
  return mapping;
}

export function readValueEventsField(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  if (!("valueEvents" in raw)) return undefined;
  return (raw as { valueEvents?: unknown }).valueEvents;
}
