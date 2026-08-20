import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { GET as getOverview } from "@/app/api/v1/overview/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { registry, sync } from "@/connectors";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { saveSourceConfig } from "@/core/sources";
import { clearWorkspace, withOfflineSuite } from "@/connectors/testing/offline";
import {
  DEFAULT_SYNC_INTERVAL_MINUTES,
  FULL_PASS_CURSOR,
  isNightlyPass,
  listScheduledTargets,
  nightlyKey,
  parseSyncIntervalMinutes,
  runScheduledPass,
  shouldStartScheduler,
  startScheduledRefresh,
  stopScheduledRefresh,
} from "./scheduler";

const WS_FRESH = "sched-fresh";
const WS_FAIL = "sched-fail";
const WS_COALESCE = "sched-coalesce";
const WS_NIGHTLY = "sched-nightly";
const WS_ENV = "sched-env-ignore";
const ICS_URL = "https://cal.example.test/private/calendar.ics";
const ADMIN = "sched-overview-admin";
const originalKey = process.env.ANYKPI_API_KEY;
const originalMercury = process.env.MERCURY_API_KEY;
const originalIcsSync = registry.ics.sync;

afterEach(async () => {
  stopScheduledRefresh();
  registry.ics.sync = originalIcsSync;
  restoreEnv("ANYKPI_API_KEY", originalKey);
  restoreEnv("MERCURY_API_KEY", originalMercury);
  vi.unstubAllEnvs();
  for (const workspace of [WS_FRESH, WS_FAIL, WS_COALESCE, WS_NIGHTLY, WS_ENV]) {
    await clearWorkspace(workspace);
  }
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, "live"));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, "live"));
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

describe("parseSyncIntervalMinutes", () => {
  it("defaults to 15 when unset, empty, or invalid", () => {
    expect(parseSyncIntervalMinutes(undefined)).toBe(DEFAULT_SYNC_INTERVAL_MINUTES);
    expect(parseSyncIntervalMinutes("")).toBe(15);
    expect(parseSyncIntervalMinutes("  ")).toBe(15);
    expect(parseSyncIntervalMinutes("nope")).toBe(15);
    expect(parseSyncIntervalMinutes("-1")).toBe(15);
  });

  it("treats 0 as disabled and accepts a positive number", () => {
    expect(parseSyncIntervalMinutes("0")).toBe(0);
    expect(parseSyncIntervalMinutes("15")).toBe(15);
    expect(parseSyncIntervalMinutes("0.05")).toBe(0.05);
  });
});

describe("shouldStartScheduler", () => {
  it("skips the Edge runtime, production build, and a 0 interval", () => {
    expect(shouldStartScheduler({ NEXT_RUNTIME: "edge" })).toBe(false);
    expect(
      shouldStartScheduler({ NEXT_PHASE: "phase-production-build" })
    ).toBe(false);
    expect(shouldStartScheduler({ SYNC_INTERVAL_MINUTES: "0" })).toBe(false);
    expect(shouldStartScheduler({ SYNC_INTERVAL_MINUTES: "15" })).toBe(true);
  });
});

describe("nightly full pass", () => {
  it("is due on the first tick and again after the UTC date rolls", () => {
    const day1 = new Date("2026-08-20T01:00:00.000Z");
    const laterSameDay = new Date("2026-08-20T18:00:00.000Z");
    const day2 = new Date("2026-08-21T00:05:00.000Z");
    expect(isNightlyPass(null, day1)).toBe(true);
    expect(isNightlyPass(nightlyKey(day1), laterSameDay)).toBe(false);
    expect(isNightlyPass(nightlyKey(day1), day2)).toBe(true);
  });

  it("passes an empty cursor on a full pass and omits it otherwise", async () => {
    await saveSourceConfig(WS_NIGHTLY, "ics", { icsUrl: ICS_URL });
    const calls: { cursor?: string }[] = [];
    const syncFn = async (
      _source: string,
      _workspaceId: string,
      opts?: { cursor?: string }
    ) => {
      calls.push({ cursor: opts?.cursor });
      return { rowsSynced: 0, nextCursor: null, health: "ok" };
    };

    await runScheduledPass({ full: true, syncFn, workspaceId: WS_NIGHTLY });
    await runScheduledPass({ full: false, syncFn, workspaceId: WS_NIGHTLY });

    expect(calls).toEqual([{ cursor: FULL_PASS_CURSOR }, { cursor: undefined }]);
  });
});

describe("listScheduledTargets", () => {
  it("includes stored pull sources and live env fallback, not csv", async () => {
    await saveSourceConfig(WS_ENV, "ics", { icsUrl: ICS_URL });
    await saveSourceConfig(WS_ENV, "csv", { kind: "events" });
    process.env.MERCURY_API_KEY = "mky_test";

    const targets = await listScheduledTargets();
    expect(targets).toContainEqual({ workspaceId: WS_ENV, source: "ics" });
    expect(targets).not.toContainEqual({ workspaceId: WS_ENV, source: "csv" });
    expect(targets).toContainEqual({ workspaceId: "live", source: "mercury" });
  });
});

describe("startScheduledRefresh", () => {
  it("does not start a timer when the interval is 0", () => {
    const handle = startScheduledRefresh({ intervalMinutes: 0 });
    expect(handle).toBeNull();
  });
});

describe("scheduled refresh — short interval e2e", () => {
  it("pulls a connected source with no manual trigger and keeps data under 20 minutes", async () => {
    await saveSourceConfig(WS_FRESH, "ics", { icsUrl: ICS_URL });

    await withOfflineSuite("ics", ["ics"], async () => {
      const handle = startScheduledRefresh({
        intervalMinutes: 1 / 6000,
        workspaceId: WS_FRESH,
      });
      expect(handle).not.toBeNull();

      try {
        await vi.waitFor(
          async () => {
            const rows = await db
              .select()
              .from(schema.syncState)
              .where(eq(schema.syncState.workspaceId, WS_FRESH))
              .all();
            expect(rows[0]?.status).toBe("success");
            expect(rows[0]?.lastSync).toBeTruthy();
          },
          { timeout: 3000 }
        );

        const state = await db
          .select()
          .from(schema.syncState)
          .where(eq(schema.syncState.workspaceId, WS_FRESH))
          .get();
        const ageMs = Date.now() - (state?.lastSync?.getTime() ?? 0);
        expect(ageMs).toBeLessThan(20 * 60 * 1000);

        const events = await db
          .select()
          .from(schema.calEvents)
          .where(eq(schema.calEvents.workspaceId, WS_FRESH))
          .all();
        expect(events.length).toBeGreaterThan(0);
      } finally {
        handle?.stop();
      }
    });
  });

  it("coalesces a scheduled pass with a concurrent manual sync()", async () => {
    let runs = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    registry.ics.sync = async () => {
      runs += 1;
      await held;
      return { rowsSynced: 1, nextCursor: null, health: "ok" };
    };

    await saveSourceConfig(WS_COALESCE, "ics", { icsUrl: ICS_URL });

    const scheduled = runScheduledPass({ workspaceId: WS_COALESCE });
    await vi.waitFor(() => {
      expect(runs).toBe(1);
    });
    const manual = sync("ics", WS_COALESCE);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(runs).toBe(1);
    release();
    await Promise.all([scheduled, manual]);
    expect(runs).toBe(1);
  });

  it("marks a failing source error and surfaces it on get_overview", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    registry.ics.sync = async () => {
      throw new Error("upstream refused");
    };
    await saveSourceConfig(WS_FAIL, "ics", { icsUrl: ICS_URL });
    await runScheduledPass({ workspaceId: WS_FAIL });

    const state = await db
      .select()
      .from(schema.syncState)
      .where(eq(schema.syncState.workspaceId, WS_FAIL))
      .get();
    expect(state?.status).toBe("error");

    const response = await getOverview(
      get(`http://localhost:3000/api/v1/overview?workspace=${WS_FAIL}`, {
        authorization: `Bearer ${ADMIN}`,
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.syncHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "ics",
          status: "error",
        }),
      ])
    );

    const mcp = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_overview",
            arguments: { workspace: WS_FAIL },
          },
        }),
      })
    );
    expect(mcp.status).toBe(200);
    const mcpBody = (await mcp.json()) as {
      result?: { content?: { text?: string }[] };
    };
    const payload = JSON.parse(mcpBody.result?.content?.[0]?.text ?? "{}") as {
      syncHealth?: { source: string; status: string }[];
    };
    expect(payload.syncHealth).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "ics", status: "error" }),
      ])
    );
  });
});

describe("scheduled refresh docs", () => {
  it("documents SYNC_INTERVAL_MINUTES=0 and the POST /api/v1/sync cron recipe", () => {
    const cron = readFileSync(resolve(__dirname, "../../docs/cron.md"), "utf8");
    const intro = readFileSync(
      resolve(__dirname, "../../docs/introduction.md"),
      "utf8"
    );
    expect(cron).toContain("SYNC_INTERVAL_MINUTES=0");
    expect(cron).toContain("POST /api/v1/sync");
    expect(cron).toMatch(/curl/);
    expect(intro).toContain("cron.md");
    expect(intro).toContain("SYNC_INTERVAL_MINUTES");
  });
});
