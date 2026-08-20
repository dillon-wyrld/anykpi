import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "./db";
import * as schema from "./schema";
import { runCsvImport } from "./csv-import";
import {
  CONNECTOR_RESTORE_NOTE,
  csvEscape,
  exportToCsvFiles,
  exportWorkspace,
  formatExport,
  rowsToCsv,
} from "./export";
import { loadCohortsView } from "./views/cohorts";
import { loadWbrView } from "./views/wbr";
import { loadCalendarView } from "./views/calendar";
import { POST as postIdentify } from "@/app/api/ingest/identify/route";
import { POST as postEvent } from "@/app/api/ingest/event/route";

const fixtures = resolve(__dirname, "../../tests/fixtures/export");
const WS = "export-roundtrip";
const ADMIN = "export-roundtrip-admin";
const originalKey = process.env.ANYKPI_API_KEY;

function fixture(name: string): string {
  return readFileSync(resolve(fixtures, name), "utf8");
}

async function wipeWorkspace(workspaceId: string): Promise<void> {
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, workspaceId));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, workspaceId));
  await db.delete(schema.personRevenue).where(eq(schema.personRevenue.workspaceId, workspaceId));
  await db.delete(schema.mrrSnapshots).where(eq(schema.mrrSnapshots.workspaceId, workspaceId));
  await db.delete(schema.subscriptionEvents).where(
    eq(schema.subscriptionEvents.workspaceId, workspaceId)
  );
  await db.delete(schema.balanceSnapshots).where(eq(schema.balanceSnapshots.workspaceId, workspaceId));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, workspaceId));
  await db.delete(schema.accounts).where(eq(schema.accounts.workspaceId, workspaceId));
  await db.delete(schema.seats).where(eq(schema.seats.workspaceId, workspaceId));
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, workspaceId));
  await db.delete(schema.metricPoints).where(eq(schema.metricPoints.workspaceId, workspaceId));
}

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await wipeWorkspace(WS);
});

async function viewNumbers(workspace: string) {
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspace))
    .all();
  const activity = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspace))
    .all();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activeToday = new Set(
    activity.filter((row) => row.timestamp >= today).map((row) => row.personId)
  ).size;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyActive = new Set(
    activity.filter((row) => row.timestamp >= weekAgo).map((row) => row.personId)
  ).size;
  const totalUsers = users.length;
  const retentionRate = weeklyActive > 0 ? Math.round((weeklyActive / totalUsers) * 100) : 0;

  const cohorts = await loadCohortsView(workspace);
  const wbr = await loadWbrView(workspace);
  const calendar = await loadCalendarView(workspace);

  return {
    totalUsers,
    activityCount: activity.length,
    activeToday,
    weeklyActive,
    retentionRate,
    smileDetected: cohorts.cohorts?.some((cohort) => cohort.smileDetected) || false,
    exceptionsCount: wbr.metrics?.filter((metric) => metric.status !== "ok").length || 0,
    upcomingEvents: calendar.events?.filter((event) => event.isFuture).length || 0,
    cohorts: (cohorts.cohorts ?? []).map((cohort) => ({
      label: cohort.label,
      size: cohort.size,
      smileDetected: cohort.smileDetected,
      retention: cohort.retention,
    })),
  };
}

async function buildCsvAndSdkWorkspace(): Promise<void> {
  const users = await runCsvImport({
    csv: fixture("users.csv"),
    kind: "users",
    workspaceId: WS,
  });
  expect(users.status).toBe("ok");

  const events = await runCsvImport({
    csv: fixture("events.csv"),
    kind: "events",
    workspaceId: WS,
  });
  expect(events.status).toBe("ok");

  process.env.ANYKPI_API_KEY = ADMIN;
  vi.stubEnv("NODE_ENV", "test");
  const identify = await postIdentify(
    new NextRequest("http://localhost:3000/api/ingest/identify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ADMIN}`,
      },
      body: JSON.stringify({
        userId: "sdk1",
        workspaceId: WS,
        properties: { name: "SDK User", email: "sdk@example.com", platform: "web" },
      }),
    })
  );
  expect(identify.status).toBe(200);

  const track = await postEvent(
    new NextRequest("http://localhost:3000/api/ingest/event", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ADMIN}`,
      },
      body: JSON.stringify({
        userId: "sdk1",
        eventName: "song_played",
        timestamp: "2026-03-01T12:00:00.000Z",
        workspaceId: WS,
        properties: { platform: "web", name: "SDK User" },
      }),
    })
  );
  expect(track.status).toBe(200);
}

describe("CSV serialization", () => {
  it("quotes commas and doubled quotes", () => {
    expect(csvEscape('Ada, Countess')).toBe('"Ada, Countess"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(
      rowsToCsv(["name", "note"], [{ name: 'Ada, Countess', note: 'ok' }])
    ).toBe('name,note\n"Ada, Countess",ok\n');
  });
});

describe("export workspace", () => {
  it("dumps users, events, and read models with a connector re-sync note", async () => {
    await buildCsvAndSdkWorkspace();
    await db.insert(schema.personRevenue).values({
      personId: "export_ada",
      status: "active",
      mrr: 20,
      ltv: 80,
      source: "stripe",
      workspaceId: WS,
    });
    await db.insert(schema.mrrSnapshots).values({
      period: new Date("2026-01-01T00:00:00.000Z"),
      grain: "month",
      mrr: 20,
      subscriberCount: 1,
      source: "stripe",
      workspaceId: WS,
    });

    const bundle = await exportWorkspace(WS);
    expect(bundle.users.length).toBe(4);
    expect(bundle.events.length).toBe(7);
    expect(bundle.users.map((row) => row.personId)).toContain("person_sdk1");
    expect(bundle.readModels.personRevenue).toHaveLength(1);
    expect(bundle.readModels.mrrSnapshots).toHaveLength(1);
    expect(bundle.readModels.personRevenue[0]?.source).toBe("stripe");

    const json = formatExport(bundle, "json");
    expect(json.restore.connectorReadModels).toBe(CONNECTOR_RESTORE_NOTE);
    expect(json.restore.connectorReadModels).toMatch(/re-sync/i);
    expect(json.counts.users).toBe(4);
    expect(json.counts.events).toBe(7);
    expect(json.counts.readModelRows).toBeGreaterThanOrEqual(2);

    const files = exportToCsvFiles(bundle);
    expect(files["users.csv"]).toMatch(/^personId,name,email/);
    expect(files["events.csv"]).toMatch(/^personId,timestamp,eventName/);
    expect(files["person_revenue.csv"]).toMatch(/export_ada/);
    expect(files["mrr_snapshots.csv"]).toMatch(/stripe/);
  });

  it("round-trips export → wipe → CSV import to identical view numbers", async () => {
    await buildCsvAndSdkWorkspace();

    const before = await viewNumbers(WS);
    expect(before.totalUsers).toBe(4);
    expect(before.activityCount).toBe(7);

    await db.insert(schema.personRevenue).values({
      personId: "export_ada",
      status: "active",
      mrr: 20,
      ltv: 80,
      source: "stripe",
      workspaceId: WS,
    });

    const files = exportToCsvFiles(await exportWorkspace(WS));
    expect(files["person_revenue.csv"]).toMatch(/export_ada/);

    await wipeWorkspace(WS);

    const empty = await viewNumbers(WS);
    expect(empty.totalUsers).toBe(0);
    expect(empty.activityCount).toBe(0);

    const users = await runCsvImport({
      csv: files["users.csv"] ?? "",
      kind: "users",
      workspaceId: WS,
    });
    expect(users.status).toBe("ok");

    const events = await runCsvImport({
      csv: files["events.csv"] ?? "",
      kind: "events",
      workspaceId: WS,
    });
    expect(events.status).toBe("ok");

    const after = await viewNumbers(WS);
    expect(after).toEqual(before);

    const revenue = await db
      .select()
      .from(schema.personRevenue)
      .where(eq(schema.personRevenue.workspaceId, WS))
      .all();
    expect(revenue).toHaveLength(0);
  });
});

describe("backup guide", () => {
  it("documents SQLite snapshot and connector re-sync", () => {
    const guide = readFileSync(resolve(__dirname, "../../docs/backup.md"), "utf8");
    expect(guide).toMatch(/anykpi export/);
    expect(guide).toMatch(/\.backup/);
    expect(guide).toMatch(/DATABASE_PATH/);
    expect(guide).toMatch(/re-sync/i);
    expect(guide).toMatch(/CSV import writes users and events only/i);
    expect(guide).toMatch(/anykpi sync/);
  });
});
