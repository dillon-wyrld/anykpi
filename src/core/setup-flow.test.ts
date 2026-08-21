import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { saveCompanyProfile } from "@/core/company-profile";
import { saveSourceConfig } from "@/core/sources";
import { upsertConfig } from "@/core/upsert";
import {
  dashboardPath,
  demoBannerStorageKey,
  hasCompanyProfile,
  hasConnectedSources,
  hasRealSync,
  parseSetupFlowStatus,
  settingsPath,
  setupFlowStorageKey,
  setupPath,
  shouldShowDemoBanner,
  shouldShowSetup,
} from "./setup-flow";
import {
  loadBannerDismissed,
  loadSetupFlowStatus,
  saveBannerDismissed,
  saveSetupFlowStatus,
  workspaceConnectedSources,
  workspaceHasProfile,
} from "./setup-flow-store";

const A = "setup-flow-a";
const B = "setup-flow-b";

afterEach(async () => {
  await db.delete(schema.config).where(eq(schema.config.workspaceId, A));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, B));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, A));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, B));
});

describe("setup-flow decisioning", () => {
  it("shows once on a workspace with no profile and nothing connected", () => {
    expect(
      shouldShowSetup({
        workspaceId: "live",
        status: "pending",
        hasProfile: false,
        hasConnections: false,
      })
    ).toBe(true);
    expect(
      shouldShowSetup({
        workspaceId: "demo",
        status: "pending",
        hasProfile: false,
        hasConnections: false,
      })
    ).toBe(false);
  });

  it("never re-traps after complete or skip", () => {
    const base = {
      workspaceId: "live",
      hasProfile: false,
      hasConnections: false,
    };
    expect(shouldShowSetup({ ...base, status: "complete" })).toBe(false);
    expect(shouldShowSetup({ ...base, status: "skipped" })).toBe(false);
    expect(
      shouldShowSetup({
        workspaceId: "live",
        status: "pending",
        hasProfile: true,
        hasConnections: false,
      })
    ).toBe(false);
    expect(
      shouldShowSetup({
        workspaceId: "live",
        status: "pending",
        hasProfile: false,
        hasConnections: true,
      })
    ).toBe(false);
  });

  it("treats the default YourCo profile as no profile", () => {
    expect(hasCompanyProfile({ companyName: "YourCo" })).toBe(false);
    expect(hasCompanyProfile({ companyName: "Harbor" })).toBe(true);
    expect(
      hasCompanyProfile({
        companyName: "YourCo",
        foundedAt: "2020-01-15T00:00:00.000Z",
      })
    ).toBe(true);
    expect(
      hasCompanyProfile({
        companyName: "YourCo",
        homeCity: { timezone: "America/Los_Angeles", label: "San Francisco" },
      })
    ).toBe(true);
  });

  it("connected sources are shipped connector ids only", () => {
    expect(hasConnectedSources([])).toBe(false);
    expect(hasConnectedSources(["csv", "webhook"])).toBe(false);
    expect(hasConnectedSources(["posthog"])).toBe(true);
  });
});

describe("demo banner vs demo seed sync_state", () => {
  it("demo seed last-sync rows are not a real sync", () => {
    const seed = [
      { source: "stripe", lastSync: "2026-01-01T00:00:00.000Z", status: "success" },
      { source: "gh", lastSync: "2026-01-01T00:00:00.000Z", status: "success" },
      { source: "anykpi", lastSync: "2026-01-01T00:00:00.000Z", status: "success" },
    ];
    expect(hasRealSync("demo", seed)).toBe(false);
    expect(hasRealSync("live", seed)).toBe(true);
    expect(hasRealSync("live", [{ source: "posthog", lastSync: null }])).toBe(false);
    expect(
      hasRealSync("demo", [
        ...seed,
        { source: "mixpanel", lastSync: "2026-08-21T00:00:00.000Z" },
      ])
    ).toBe(true);
  });

  it("shows until first real sync, then leaves; dismiss sticks", () => {
    expect(
      shouldShowDemoBanner({
        workspaceId: "demo",
        dismissed: false,
        hasRealSync: false,
      })
    ).toBe(true);
    expect(
      shouldShowDemoBanner({
        workspaceId: "demo",
        dismissed: true,
        hasRealSync: false,
      })
    ).toBe(false);
    expect(
      shouldShowDemoBanner({
        workspaceId: "demo",
        dismissed: false,
        hasRealSync: true,
      })
    ).toBe(false);
    expect(
      shouldShowDemoBanner({
        workspaceId: "live",
        dismissed: false,
        hasRealSync: false,
        labeledDemo: true,
      })
    ).toBe(true);
    expect(
      shouldShowDemoBanner({
        workspaceId: "live",
        dismissed: false,
        hasRealSync: true,
        labeledDemo: true,
      })
    ).toBe(false);
  });
});

describe("complete/skip remembered per workspace", () => {
  it("config-table status does not leak across workspaces", async () => {
    await saveSetupFlowStatus(A, "complete");
    await saveSetupFlowStatus(B, "skipped");
    expect(await loadSetupFlowStatus(A)).toBe("complete");
    expect(await loadSetupFlowStatus(B)).toBe("skipped");
    expect(await loadSetupFlowStatus("setup-flow-empty")).toBe("pending");

    await saveBannerDismissed(A);
    expect(await loadBannerDismissed(A)).toBe(true);
    expect(await loadBannerDismissed(B)).toBe(false);
  });

  it("profile and connected sources are per workspace", async () => {
    expect(await workspaceHasProfile(A)).toBe(false);
    await saveCompanyProfile(A, { companyName: "Harbor" });
    expect(await workspaceHasProfile(A)).toBe(true);
    expect(await workspaceHasProfile(B)).toBe(false);

    process.env.ANYKPI_SECRET = process.env.ANYKPI_SECRET || "setup-flow-test-secret";
    await saveSourceConfig(A, "ics", { icsUrl: "https://example.com/cal.ics" });
    expect(await workspaceConnectedSources(A)).toEqual(["ics"]);
    expect(await workspaceConnectedSources(B)).toEqual([]);
  });

  it("storage keys stay per workspace", () => {
    expect(setupFlowStorageKey(A)).not.toBe(setupFlowStorageKey(B));
    expect(demoBannerStorageKey(A)).not.toBe(demoBannerStorageKey(B));
    expect(parseSetupFlowStatus("complete")).toBe("complete");
    expect(parseSetupFlowStatus("nope")).toBe("pending");
    expect(setupPath("live")).toBe("/connect?setup=1&workspace=live");
    expect(settingsPath("live")).toContain("settings=1");
    expect(dashboardPath("demo")).toContain("workspace=demo");
  });

  it("saving YourCo alone does not count as a profile", async () => {
    await upsertConfig({
      key: `company_name:${A}`,
      value: "YourCo",
      workspaceId: A,
    });
    expect(await workspaceHasProfile(A)).toBe(false);
  });
});
