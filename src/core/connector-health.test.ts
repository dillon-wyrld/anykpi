import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ConnectorHealthList } from "@/app/connect/ConnectorHealthPanel";
import { GET as getOverview } from "@/app/api/v1/overview/route";
import { GET as getSync } from "@/app/api/v1/sync/route";
import {
  formatNextRunLabel,
  humanizeSyncError,
  nextRunIso,
  presentConnectorHealth,
  statusCodeFromError,
} from "@/core/connector-health";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertSyncState } from "@/core/upsert";
import type { SyncHealth } from "@/core/contracts";

const ADMIN = "connector-health-admin";
const WS = "connect-health";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
});

const ERRORED_FIXTURE: SyncHealth = {
  source: "mixpanel",
  sourceName: "Mixpanel",
  status: "error",
  lastSynced: "2026-08-20T06:00:00.000Z",
  error: "401",
};

function renderPanel(
  health: SyncHealth[],
  opts: { intervalMinutes: number; now: Date; rowsSynced?: Record<string, number> }
) {
  const rows = presentConnectorHealth(health, opts);
  return renderToStaticMarkup(
    createElement(ConnectorHealthList, {
      rows,
      syncing: null,
      onSync: () => undefined,
    })
  );
}

describe("humanizeSyncError", () => {
  it("turns stored tokens and status codes into what happened and what to do next", () => {
    expect(humanizeSyncError("unauthorized").problem).toMatch(/rejected the credentials/i);
    expect(humanizeSyncError("unauthorized").nextStep).toMatch(/Update the key/i);
    expect(humanizeSyncError("401")).toEqual(humanizeSyncError("unauthorized"));
    expect(humanizeSyncError("HTTP 403")).toEqual(humanizeSyncError("unauthorized"));

    expect(humanizeSyncError("rate limited").problem).toMatch(/wait before pulling/i);
    expect(humanizeSyncError("429")).toEqual(humanizeSyncError("rate limited"));

    expect(humanizeSyncError("sync failed").problem).toMatch(/did not finish/i);
    expect(humanizeSyncError("500").problem).toMatch(/did not complete the pull/i);
    expect(humanizeSyncError("").nextStep).toMatch(/sync now/i);
  });

  it("never echoes a status code in the copy", () => {
    for (const raw of ["401", "403", "429", "500", "HTTP 502", "unauthorized"]) {
      const copy = `${humanizeSyncError(raw).problem} ${humanizeSyncError(raw).nextStep}`;
      expect(copy).not.toMatch(/\b[1-5]\d{2}\b/);
      expect(statusCodeFromError(raw) === null || !copy.includes(String(statusCodeFromError(raw)))).toBe(
        true
      );
    }
  });
});

describe("next run reflects SYNC_INTERVAL_MINUTES", () => {
  const lastSynced = "2026-08-20T06:00:00.000Z";

  it("adds the interval onto last sync", () => {
    expect(nextRunIso(lastSynced, 15)).toBe("2026-08-20T06:15:00.000Z");
    expect(nextRunIso(lastSynced, 5)).toBe("2026-08-20T06:05:00.000Z");
    expect(nextRunIso(lastSynced, 30)).toBe("2026-08-20T06:30:00.000Z");
  });

  it("labels a future run relative to now and a past run as due", () => {
    expect(
      formatNextRunLabel(lastSynced, 15, new Date("2026-08-20T06:05:00.000Z"))
    ).toBe("in 10m");
    expect(
      formatNextRunLabel(lastSynced, 15, new Date("2026-08-20T06:20:00.000Z"))
    ).toBe("Due now");
  });

  it("explains scheduler-off when the interval is 0", () => {
    expect(nextRunIso(lastSynced, 0)).toBeNull();
    expect(formatNextRunLabel(lastSynced, 0)).toMatch(/Scheduler off/i);
    expect(formatNextRunLabel(lastSynced, 0)).toContain("POST /api/v1/sync");
  });
});

describe("connector health panel from an errored fixture", () => {
  it("renders what went wrong and what to do, not a status code", () => {
    const html = renderPanel([ERRORED_FIXTURE], {
      intervalMinutes: 15,
      now: new Date("2026-08-20T06:05:00.000Z"),
      rowsSynced: { mixpanel: 0 },
    });

    expect(html).toContain("Mixpanel");
    expect(html).toContain("Needs attention");
    expect(html).toContain("This source rejected the credentials ANYKPI has stored.");
    expect(html).toContain("Update the key on this page, then sync now.");
    expect(html).not.toContain("401");
    expect(html).toContain("2026-08-20T06:15:00.000Z");
    expect(html).toContain("in 10m");
    expect(html).toContain("0 rows");
    expect(html).toContain("Sync Mixpanel now");
  });

  it("loads that fixture through overview + sync_state and presents next-run from the interval", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SYNC_INTERVAL_MINUTES", "15");

    await upsertSyncState({
      source: "mixpanel",
      sourceName: "Mixpanel",
      lastSync: new Date("2026-08-20T06:00:00.000Z"),
      status: "error",
      error: "401",
      workspaceId: WS,
    });

    const overview = await getOverview(
      new NextRequest(
        `http://localhost:3000/api/v1/overview?workspace=${WS}`,
        { headers: { authorization: `Bearer ${ADMIN}` } }
      )
    );
    expect(overview.status).toBe(200);
    const overviewBody = (await overview.json()) as { syncHealth: SyncHealth[] };
    expect(overviewBody.syncHealth).toEqual([
      expect.objectContaining({
        source: "mixpanel",
        status: "error",
        error: "401",
        lastSynced: "2026-08-20T06:00:00.000Z",
      }),
    ]);

    const sync = await getSync(
      new NextRequest(`http://localhost:3000/api/v1/sync?workspace=${WS}`, {
        headers: { authorization: `Bearer ${ADMIN}` },
      })
    );
    expect(sync.status).toBe(200);
    const syncBody = (await sync.json()) as { syncIntervalMinutes: number };
    expect(syncBody.syncIntervalMinutes).toBe(15);

    const html = renderPanel(overviewBody.syncHealth, {
      intervalMinutes: syncBody.syncIntervalMinutes,
      now: new Date("2026-08-20T06:05:00.000Z"),
    });
    expect(html).toContain("rejected the credentials");
    expect(html).not.toContain("401");
    expect(html).toContain("2026-08-20T06:15:00.000Z");
  });

  it("GET /api/v1/sync reports a non-default SYNC_INTERVAL_MINUTES", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SYNC_INTERVAL_MINUTES", "5");

    const sync = await getSync(
      new NextRequest("http://localhost:3000/api/v1/sync?workspace=demo")
    );
    expect(sync.status).toBe(200);
    const body = (await sync.json()) as { syncIntervalMinutes: number };
    expect(body.syncIntervalMinutes).toBe(5);

    expect(nextRunIso("2026-08-20T06:00:00.000Z", body.syncIntervalMinutes)).toBe(
      "2026-08-20T06:05:00.000Z"
    );
  });
});
