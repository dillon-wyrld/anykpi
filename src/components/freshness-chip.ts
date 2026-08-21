/**
 * Freshness chip presentation. Healthy workspaces keep the time-ago
 * label. A failing source turns the chip into a link to /connect#health.
 */

export const CONNECT_HEALTH_HREF = "/connect#health";

export type FreshnessChipKind = "ok" | "error" | "unknown";

export type FreshnessChipState = {
  kind: FreshnessChipKind;
  label: string | null;
  href: string | null;
};

export const FRESHNESS_CHIP_UNKNOWN: FreshnessChipState = {
  kind: "unknown",
  label: null,
  href: null,
};

export const FRESHNESS_CHIP_OK: FreshnessChipState = {
  kind: "ok",
  label: null,
  href: null,
};

export type FreshnessChipSource = {
  source: string;
  sourceName?: string;
  status: string;
  error?: string | null;
};

export function freshnessChipFromStates(
  states: readonly FreshnessChipSource[]
): FreshnessChipState {
  const failed = states.filter((row) => row.status === "error");
  if (failed.length === 0) return FRESHNESS_CHIP_OK;

  const first = failed[0];
  const name = (first.sourceName || first.source).trim() || "Source";
  const label =
    failed.length === 1 ? `${name} needs attention` : `${failed.length} sources need attention`;

  return {
    kind: "error",
    label,
    href: CONNECT_HEALTH_HREF,
  };
}
