/**
 * First-run setup decisioning. Client-safe — no database imports.
 *
 * Complete / skip is remembered per workspace (localStorage in the
 * browser; the same key shape is stored in `config` by setup-flow-store).
 * Demo seed writes sync_state for calendar stand-ins (including `stripe`);
 * those rows are not a real connector sync.
 */

import { DEFAULT_COMPANY_NAME } from "@/core/company-day";
import { SHIPPED_SOURCE_IDS } from "@/core/source-gallery";

export const DEMO_WORKSPACE = "demo";

export const SETUP_FLOW_STATUSES = ["pending", "complete", "skipped"] as const;
export type SetupFlowStatus = (typeof SETUP_FLOW_STATUSES)[number];

export const SETUP_FLOW_CONFIG_KEY = "setup_flow";
export const DEMO_BANNER_CONFIG_KEY = "demo_banner_dismissed";

export function setupFlowConfigKey(workspaceId: string): string {
  return `${SETUP_FLOW_CONFIG_KEY}:${workspaceId}`;
}

export function demoBannerConfigKey(workspaceId: string): string {
  return `${DEMO_BANNER_CONFIG_KEY}:${workspaceId}`;
}

export function setupFlowStorageKey(workspaceId: string): string {
  return `anykpi:setup-flow:${workspaceId}`;
}

export function demoBannerStorageKey(workspaceId: string): string {
  return `anykpi:demo-banner:${workspaceId}`;
}

export function labeledDemoStorageKey(workspaceId: string): string {
  return `anykpi:labeled-demo:${workspaceId}`;
}

export function parseSetupFlowStatus(raw: string | null | undefined): SetupFlowStatus {
  if (raw === "complete" || raw === "skipped") return raw;
  return "pending";
}

export function isDefaultProfile(profile: {
  companyName?: string | null;
  foundedAt?: string | null;
  homeCity?: { timezone: string; label: string } | null;
}): boolean {
  const name = profile.companyName?.trim() || DEFAULT_COMPANY_NAME;
  return name === DEFAULT_COMPANY_NAME && !profile.foundedAt && !profile.homeCity;
}

export function hasCompanyProfile(profile: {
  companyName?: string | null;
  foundedAt?: string | null;
  homeCity?: { timezone: string; label: string } | null;
}): boolean {
  return !isDefaultProfile(profile);
}

const SHIPPED = new Set<string>(SHIPPED_SOURCE_IDS);

/**
 * Demo seed writes sync_state for calendar stand-ins. `stripe` is the
 * only slug that collides with the connector registry; the others
 * (`gh`, `rc`, `gcal`, `plaid`, `anykpi`) are not shipped source ids.
 */
const DEMO_SEED_SYNC_SOURCES = new Set([
  "gcal",
  "stripe",
  "rc",
  "plaid",
  "gh",
  "anykpi",
]);

/** A stored credential row for a shipped connector. */
export function hasConnectedSources(sourceIds: string[]): boolean {
  return sourceIds.some((id) => SHIPPED.has(id));
}

/**
 * Real sync: a shipped connector has a last-sync stamp. Demo seed
 * last-sync for `stripe` (and the other stand-ins) is ignored so the
 * banner stays honest until an operator-triggered pull.
 */
export function hasRealSync(
  workspaceId: string,
  sources: Array<{ source: string; lastSync?: string | null; status?: string }>
): boolean {
  return sources.some((row) => {
    if (!SHIPPED.has(row.source) || !row.lastSync) return false;
    if (workspaceId === DEMO_WORKSPACE && DEMO_SEED_SYNC_SOURCES.has(row.source)) {
      return false;
    }
    return true;
  });
}

export function shouldShowSetup(input: {
  workspaceId: string;
  status: SetupFlowStatus;
  hasProfile: boolean;
  hasConnections: boolean;
}): boolean {
  if (input.workspaceId === DEMO_WORKSPACE) return false;
  if (input.status === "complete" || input.status === "skipped") return false;
  if (input.hasProfile || input.hasConnections) return false;
  return true;
}

/**
 * Labeled demo mode. Demo seed sync_state is not real data, so the
 * banner stays on `demo` until dismissed. On a live workspace it shows
 * after "explore demo first" / skip until a shipped connector syncs.
 */
export function shouldShowDemoBanner(input: {
  workspaceId: string;
  dismissed: boolean;
  hasRealSync: boolean;
  labeledDemo?: boolean;
}): boolean {
  if (input.dismissed) return false;
  if (input.hasRealSync) return false;
  if (input.workspaceId === DEMO_WORKSPACE) return true;
  return input.labeledDemo === true;
}

export function readSetupStatus(workspaceId: string): SetupFlowStatus {
  if (typeof window === "undefined") return "pending";
  try {
    return parseSetupFlowStatus(window.localStorage.getItem(setupFlowStorageKey(workspaceId)));
  } catch {
    return "pending";
  }
}

export function writeSetupStatus(
  workspaceId: string,
  status: "complete" | "skipped"
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(setupFlowStorageKey(workspaceId), status);
  } catch {
    // Private mode can refuse storage; the flow still completes this visit.
  }
}

export function readBannerDismissed(workspaceId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(demoBannerStorageKey(workspaceId)) === "1";
  } catch {
    return false;
  }
}

export function writeBannerDismissed(workspaceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(demoBannerStorageKey(workspaceId), "1");
  } catch {
    // Same as writeSetupStatus.
  }
}

export function readLabeledDemo(workspaceId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(labeledDemoStorageKey(workspaceId)) === "1";
  } catch {
    return false;
  }
}

export function writeLabeledDemo(workspaceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(labeledDemoStorageKey(workspaceId), "1");
  } catch {
    // Same as writeSetupStatus.
  }
}

export function setupPath(workspaceId: string): string {
  return `/connect?setup=1&workspace=${encodeURIComponent(workspaceId)}`;
}

export function settingsPath(workspaceId: string): string {
  return `/connect?settings=1&workspace=${encodeURIComponent(workspaceId)}`;
}

export function dashboardPath(workspaceId: string, view = "dotplot"): string {
  return `/dashboard?workspace=${encodeURIComponent(workspaceId)}&view=${encodeURIComponent(view)}`;
}
