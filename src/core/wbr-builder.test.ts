import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postMetric, PATCH as patchMetric } from "@/app/api/v1/metrics/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import {
  DefineMetricRequestSchema,
  MetricPatchRequestSchema,
} from "@/core/contracts";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadWbrView } from "@/core/views/wbr";
import {
  acceptStarterProposals,
  countActives,
  countSignups,
  defineMetric,
  editMetric,
  importManualCsv,
  parseManualCsv,
  reorderMetrics,
  retireMetric,
  takenMetricIds,
  trailingWeekStarts,
} from "@/core/wbr-builder";

const ADMIN = "wbr-builder-admin";
const WS = "wbr-builder";

const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, WS));
  await db.delete(schema.metricPoints).where(eq(schema.metricPoints.workspaceId, WS));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
  await db.delete(schema.mrrSnapshots).where(eq(schema.mrrSnapshots.workspaceId, WS));
});

function asBearer(url: string, key: string, body: unknown, method = "POST") {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
}

function seedPeople() {
  const week = trailingWeekStarts(new Date(), 6);
  return Promise.all([
    db.insert(schema.users).values({
      personId: `${WS}-ada`,
      name: "Ada",
      platform: "web",
      signupDate: week[1],
      workspaceId: WS,
    }),
    db.insert(schema.users).values({
      personId: `${WS}-bea`,
      name: "Bea",
      platform: "ios",
      signupDate: week[4],
      workspaceId: WS,
    }),
    db.insert(schema.activity).values({
      personId: `${WS}-ada`,
      timestamp: new Date(week[5].getTime() + 3600_000),
      eventName: "song_played",
      eventClass: "core",
      workspaceId: WS,
    }),
    db.insert(schema.activity).values({
      personId: `${WS}-bea`,
      timestamp: new Date(week[5].getTime() + 7200_000),
      eventName: "song_played",
      eventClass: "core",
      workspaceId: WS,
    }),
  ]);
}

describe("define_metric contract refuses a status field", () => {
  const base = {
    name: "Weekly actives",
    section: "eng",
    type: "input",
    source: { kind: "event_count", measure: "actives" },
  };

  it("parses a valid define body", () => {
    expect(DefineMetricRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects status on define, edit, accept, retire, reorder, and import", () => {
    expect(
      DefineMetricRequestSchema.safeParse({ ...base, status: "ok" }).success
    ).toBe(false);
    expect(
      DefineMetricRequestSchema.safeParse({ ...base, statusReason: "nope" }).success
    ).toBe(false);
    for (const body of [
      { action: "edit", id: "x", target: 1, status: "off" },
      { action: "accept", status: "ok" },
      { action: "retire", id: "x", status: "watch" },
      { action: "reorder", order: ["a"], status: "ok" },
      { action: "import", id: "x", csv: "a,1", status: "ok" },
    ]) {
      expect(MetricPatchRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("event-count helpers", () => {
  it("counts signups and actives in week windows", () => {
    const starts = [
      new Date("2026-08-03T00:00:00.000Z"),
      new Date("2026-08-10T00:00:00.000Z"),
    ];
    const users = [
      { signupDate: new Date("2026-08-04T00:00:00.000Z") },
      { signupDate: new Date("2026-08-11T00:00:00.000Z") },
    ];
    expect(countSignups(users, starts, 7 * 86400000)).toEqual([1, 1]);
    expect(
      countActives(
        [
          { personId: "a", timestamp: new Date("2026-08-04T12:00:00.000Z") },
          { personId: "a", timestamp: new Date("2026-08-05T12:00:00.000Z") },
          { personId: "b", timestamp: new Date("2026-08-11T12:00:00.000Z") },
        ],
        starts,
        7 * 86400000
      )
    ).toEqual([1, 1]);
  });
});

describe("human create / edit / reorder / retire", () => {
  it("writes one row, edits the target without touching points, reorders, and retires", async () => {
    const created = await defineMetric(WS, {
      name: "Manual NPS",
      section: "qua",
      type: "input",
      unit: "",
      target: 40,
      goodDir: "up",
      source: { kind: "manual" },
      points: [
        { timestamp: "2026-08-03T00:00:00.000Z", value: 41, grain: "week" },
        { timestamp: "2026-08-10T00:00:00.000Z", value: 44, grain: "week" },
      ],
    });
    expect(created.metricId).toBe("manual_nps");
    expect(created.lifecycle).toBe("active");

    const before = await db
      .select()
      .from(schema.metricPoints)
      .where(eq(schema.metricPoints.workspaceId, WS))
      .all();
    expect(before).toHaveLength(2);

    const edited = await editMetric(WS, { id: "manual_nps", target: 50 });
    expect(edited.target).toBe(50);
    const after = await db
      .select()
      .from(schema.metricPoints)
      .where(eq(schema.metricPoints.workspaceId, WS))
      .all();
    expect(after).toEqual(before);

    await defineMetric(WS, {
      name: "Second",
      section: "acq",
      type: "input",
      source: { kind: "event_count", measure: "signups" },
    });
    await reorderMetrics(WS, ["second", "manual_nps"]);
    const defs = await db
      .select()
      .from(schema.metricDefs)
      .where(eq(schema.metricDefs.workspaceId, WS))
      .all();
    const nps = defs.find((row) => row.metricId === "manual_nps");
    const second = defs.find((row) => row.metricId === "second");
    expect(second?.sectionOrder.localeCompare(nps?.sectionOrder ?? "")).toBeLessThan(0);

    await retireMetric(WS, "manual_nps");
    const view = await loadWbrView(WS);
    expect(view.metrics.map((m) => m.id)).toEqual(["second"]);
    expect(view.metrics.map((m) => m.id)).not.toContain("manual_nps");
  });
});

describe("agent define_metric is indistinguishable from the human write", () => {
  it("produces the same metric_defs row", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    const body = {
      name: "Weekly actives",
      section: "eng" as const,
      type: "input" as const,
      unit: "",
      target: 2,
      goodDir: "up" as const,
      source: { kind: "event_count" as const, measure: "actives" as const },
    };
    const human = await defineMetric(`${WS}-h`, body);
    const minted = await createKey(
      asBearer("http://localhost:3000/api/v1/keys", ADMIN, {
        name: "agent",
        scope: "write",
        workspace: `${WS}-a`,
      })
    );
    const { key } = (await minted.json()) as { key: string };
    const mcp = await postMcp(
      asBearer("http://localhost:3000/api/mcp", key, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "define_metric",
          arguments: { ...body, workspace: `${WS}-a` },
        },
      })
    );
    expect(mcp.status).toBe(200);
    const agentRows = await db
      .select()
      .from(schema.metricDefs)
      .where(eq(schema.metricDefs.workspaceId, `${WS}-a`))
      .all();
    const humanRows = await db
      .select()
      .from(schema.metricDefs)
      .where(eq(schema.metricDefs.workspaceId, `${WS}-h`))
      .all();
    expect(agentRows).toHaveLength(1);
    expect(humanRows).toHaveLength(1);
    const strip = (row: (typeof agentRows)[0]) => ({
      metricId: row.metricId,
      name: row.name,
      section: row.section,
      owner: row.owner,
      type: row.type,
      unit: row.unit,
      target: row.target,
      goodDir: row.goodDir,
      status: row.status,
      statusReason: row.statusReason,
    });
    expect(strip(agentRows[0])).toEqual(strip(humanRows[0]));
    expect(human.metricId).toBe(agentRows[0]?.metricId);
    await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, `${WS}-h`));
    await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, `${WS}-a`));
    await db.delete(schema.config).where(eq(schema.config.workspaceId, `${WS}-h`));
    await db.delete(schema.config).where(eq(schema.config.workspaceId, `${WS}-a`));
    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, `${WS}-a`));
  });
});

describe("manual CSV import dedups", () => {
  it("updates an existing week instead of inserting a second row", async () => {
    await defineMetric(WS, {
      name: "Headcount",
      section: "fin",
      type: "input",
      source: { kind: "manual" },
    });
    const csv = "timestamp,value,grain\n2026-08-03T00:00:00.000Z,10,week\n";
    expect(parseManualCsv(csv)).toHaveLength(1);
    const first = await importManualCsv(WS, "headcount", csv);
    expect(first.imported).toBe(1);
    const again = await importManualCsv(
      WS,
      "headcount",
      "timestamp,value,grain\n2026-08-03T00:00:00.000Z,12,week\n"
    );
    expect(again.imported).toBe(0);
    expect(again.updated).toBe(1);
    const points = await db
      .select()
      .from(schema.metricPoints)
      .where(eq(schema.metricPoints.workspaceId, WS))
      .all();
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(12);
  });
});

describe("starter deck on a fresh live workspace", () => {
  it("proposes from connected data and accept writes a working deck", async () => {
    await seedPeople();
    const before = await loadWbrView(WS);
    expect(before.metrics).toHaveLength(0);
    expect(before.proposals.map((p) => p.id)).toEqual(
      expect.arrayContaining(["wbr_signups", "wbr_actives", "wbr_retention"])
    );
    expect(before.proposals.every((p) => p.lifecycle === "proposal")).toBe(true);
    expect(["ok", "watch", "off"]).toContain(before.proposals[0]?.status);

    const written = await acceptStarterProposals(WS);
    expect(written.length).toBeGreaterThanOrEqual(3);
    const after = await loadWbrView(WS);
    expect(after.proposals).toHaveLength(0);
    expect(after.metrics.map((m) => m.id)).toEqual(
      expect.arrayContaining(["wbr_signups", "wbr_actives", "wbr_retention"])
    );
    expect(after.metrics.every((m) => ["ok", "watch", "off"].includes(m.status))).toBe(
      true
    );
    expect(after.metrics.find((m) => m.id === "wbr_actives")?.weeks.length).toBe(6);
  });
});

describe("REST write path refuses status and shares define_metric", () => {
  it("POST /api/v1/metrics rejects status and writes the same row MCP would", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    const refused = await postMetric(
      asBearer("http://localhost:3000/api/v1/metrics", ADMIN, {
        workspace: WS,
        name: "X",
        section: "acq",
        type: "input",
        source: { kind: "manual" },
        status: "off",
      })
    );
    expect(refused.status).toBe(400);

    const created = await postMetric(
      asBearer("http://localhost:3000/api/v1/metrics", ADMIN, {
        workspace: WS,
        name: "Paid conversions",
        section: "act",
        type: "output",
        source: { kind: "event_count", eventName: "checkout_completed" },
      })
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { metric: { id: string } };
    expect(body.metric.id).toBe("paid_conversions");

    const patched = await patchMetric(
      asBearer(
        "http://localhost:3000/api/v1/metrics",
        ADMIN,
        { action: "edit", id: "paid_conversions", target: 9, status: "ok" },
        "PATCH"
      )
    );
    expect(patched.status).toBe(400);
  });
});

describe("takenMetricIds", () => {
  it("treats deck-less defs as taken so a starter does not replace them", () => {
    const taken = takenMetricIds(
      {
        version: 1,
        specs: {
          wbr_signups: { source: { kind: "event_count", measure: "signups" }, lifecycle: "retired" },
          wbr_actives: { source: { kind: "event_count", measure: "actives" }, lifecycle: "active" },
        },
        order: ["wbr_actives"],
      },
      [{ metricId: "custom_nps" }]
    );
    expect(taken.has("wbr_signups")).toBe(true);
    expect(taken.has("wbr_actives")).toBe(true);
    expect(taken.has("custom_nps")).toBe(true);
    expect(taken.has("wbr_retention")).toBe(false);
  });
});
