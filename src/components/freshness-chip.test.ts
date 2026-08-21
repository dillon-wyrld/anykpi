import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { FreshnessChip } from "@/components/FreshnessChip";
import {
  CONNECT_HEALTH_HREF,
  FRESHNESS_CHIP_OK,
  freshnessChipFromStates,
} from "@/components/freshness-chip";
import { GET as getSync } from "@/app/api/v1/sync/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertSyncState } from "@/core/upsert";

const ADMIN = "freshness-chip-admin";
const WS = "freshness-chip-ws";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
});

describe("freshnessChipFromStates", () => {
  it("stays quiet when every source is healthy or pending", () => {
    expect(
      freshnessChipFromStates([
        { source: "posthog", sourceName: "PostHog", status: "success" },
        { source: "ics", sourceName: "Calendar", status: "pending" },
      ])
    ).toEqual(FRESHNESS_CHIP_OK);
    expect(freshnessChipFromStates([])).toEqual(FRESHNESS_CHIP_OK);
  });

  it("shows an error state that links to the connector health panel", () => {
    const chip = freshnessChipFromStates([
      {
        source: "mixpanel",
        sourceName: "Mixpanel",
        status: "error",
        error: "401",
      },
    ]);
    expect(chip.kind).toBe("error");
    expect(chip.label).toBe("Mixpanel needs attention");
    expect(chip.href).toBe(CONNECT_HEALTH_HREF);
    expect(chip.label).not.toMatch(/\b[1-5]\d{2}\b/);
    expect(chip.href).toContain("#health");
  });

  it("counts multiple failing sources without echoing stored errors", () => {
    const chip = freshnessChipFromStates([
      { source: "mixpanel", sourceName: "Mixpanel", status: "error", error: "401" },
      { source: "stripe", sourceName: "Stripe", status: "error", error: "rate limited" },
    ]);
    expect(chip.label).toBe("2 sources need attention");
    expect(chip.href).toBe(CONNECT_HEALTH_HREF);
    expect(JSON.stringify(chip)).not.toContain("401");
    expect(JSON.stringify(chip)).not.toContain("rate limited");
  });
});

describe("FreshnessChip", () => {
  it("renders the error chip as a link to /connect#health", () => {
    const html = renderToStaticMarkup(
      createElement(FreshnessChip, {
        health: {
          kind: "error",
          label: "Mixpanel needs attention",
          href: CONNECT_HEALTH_HREF,
        },
        testId: "daytrack-freshness",
      })
    );
    expect(html).toContain('data-testid="daytrack-freshness"');
    expect(html).toContain('data-freshness="error"');
    expect(html).toContain(`href="${CONNECT_HEALTH_HREF}"`);
    expect(html).toContain("Mixpanel needs attention");
    expect(html).toContain("<a ");
  });

  it("falls back to the time-ago label when sources are healthy", () => {
    const html = renderToStaticMarkup(
      createElement(FreshnessChip, {
        health: FRESHNESS_CHIP_OK,
        fallbackLabel: "5m ago",
        testId: "daytrack-freshness",
      })
    );
    expect(html).toContain("5m ago");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("data-freshness");
  });
});

describe("freshness chip from a failing GET /api/v1/sync", () => {
  it("learns error from sync_state and points at the health panel", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    await upsertSyncState({
      source: "mixpanel",
      sourceName: "Mixpanel",
      lastSync: new Date("2026-08-20T06:00:00.000Z"),
      status: "error",
      error: "401",
      workspaceId: WS,
    });

    const response = await getSync(
      new NextRequest(`http://localhost:3000/api/v1/sync?workspace=${WS}`, {
        headers: { authorization: `Bearer ${ADMIN}` },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      states: Array<{ source: string; sourceName: string; status: string; error?: string }>;
    };
    const chip = freshnessChipFromStates(body.states);
    expect(chip.kind).toBe("error");
    expect(chip.href).toBe(CONNECT_HEALTH_HREF);
    expect(chip.label).toMatch(/needs attention/i);
    expect(chip.label).not.toContain("401");
  });
});

describe("dashboard wiring", () => {
  it("hooks the chip into useFreshness and the Day of YourCo freshness slot", () => {
    const root = resolve(__dirname, "../..");
    const hook = readFileSync(resolve(root, "src/components/useFreshness.ts"), "utf8");
    const chip = readFileSync(resolve(root, "src/components/FreshnessChip.tsx"), "utf8");
    const daytrack = readFileSync(resolve(root, "src/components/DayTracker.tsx"), "utf8");
    const panel = readFileSync(
      resolve(root, "src/app/connect/ConnectorHealthPanel.tsx"),
      "utf8"
    );

    expect(hook).toContain("freshnessChipFromStates");
    expect(hook).toContain("/api/v1/sync");
    expect(hook).toContain('workspace !== "demo"');
    expect(chip).toContain("data-freshness");
    expect(chip).toContain("health.href");
    expect(daytrack).toContain("FreshnessChip");
    expect(daytrack).toContain("daytrack-freshness");
    expect(panel).toContain('id="health"');
  });
});
