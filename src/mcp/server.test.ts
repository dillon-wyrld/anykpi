import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postMcp } from "@/app/api/mcp/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { decodeViewState } from "@/core/view-state";
import { activityWindow, buildDotPlotUsers } from "@/core/views/dotplot";
import { loadFreshness } from "@/core/freshness";
import { parseSyncIntervalMinutes } from "@/core/scheduler-env";
import {
  ActivityResponseSchema,
  PINNED_STDIO_MCP_TOOLS,
  SyncStatusResponseSchema,
  missingPinnedMcpTools,
} from "@/core/contracts";
import { handleStdioToolCall, listStdioMcpTools } from "./server";

const WS = "stdio-live-views";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, WS));
  await db.delete(schema.metricDefs).where(eq(schema.metricDefs.workspaceId, WS));
  await db.delete(schema.metricPoints).where(eq(schema.metricPoints.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
});

function parseTool(result: { content: { text: string }[]; isError?: boolean }) {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

describe("stdio MCP live views", () => {
  it("reads live cohorts, WBR, and calendar in-process without a views fetch", async () => {
    await db.insert(schema.users).values({
      personId: `${WS}-p1`,
      name: "Stdio Live",
      platform: "web",
      signupDate: new Date("2026-01-01T00:00:00Z"),
      workspaceId: WS,
    });
    await db.insert(schema.activity).values({
      personId: `${WS}-p1`,
      timestamp: new Date("2026-01-02T00:00:00Z"),
      eventName: "song_played",
      eventClass: "core",
      workspaceId: WS,
    });
    await db.insert(schema.calEvents).values({
      source: "ics",
      sourceName: "Calendar",
      sourceColor: "#2563eb",
      type: "comms",
      emoji: "📅",
      title: "Stdio standup",
      badge: "all day",
      eventDate: new Date("2026-08-01T00:00:00Z"),
      isFuture: false,
      workspaceId: WS,
    });
    await db.insert(schema.metricDefs).values({
      metricId: `${WS}-wau`,
      name: "WAU",
      section: "Audience",
      sectionOrder: "1",
      owner: "founder",
      type: "output",
      unit: "",
      target: 10,
      goodDir: "up",
      status: "ok",
      workspaceId: WS,
    });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const cohorts = parseTool(
      await handleStdioToolCall("get_cohorts", { workspace: WS })
    );
    const wbr = parseTool(await handleStdioToolCall("get_wbr", { workspace: WS }));
    const calendar = parseTool(
      await handleStdioToolCall("get_calendar", { workspace: WS })
    );

    expect(Array.isArray(cohorts.cohorts)).toBe(true);
    expect(String(cohorts.viewUrl)).toContain("/dashboard");
    expect(Array.isArray(wbr.metrics)).toBe(true);
    const wbrState = new URL(String(wbr.viewUrl)).searchParams.get("state");
    expect(wbrState ? decodeViewState(wbrState)?.view : null).toBe("wbr");
    expect(calendar.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Stdio standup" })])
    );
    const calState = new URL(String(calendar.viewUrl)).searchParams.get("state");
    expect(calState ? decodeViewState(calState)?.view : null).toBe("calendar");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("get_activity returns the same matrix the dashboard reads plus view_url", async () => {
    await db.insert(schema.users).values({
      personId: `${WS}-p1`,
      name: "Stdio Live",
      platform: "web",
      signupDate: new Date("2026-01-01T00:00:00Z"),
      workspaceId: WS,
    });
    await db.insert(schema.activity).values({
      personId: `${WS}-p1`,
      timestamp: new Date("2026-01-02T00:00:00Z"),
      eventName: "song_played",
      eventClass: "core",
      workspaceId: WS,
    });

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    const activities = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    const expected = buildDotPlotUsers(users, activities);
    const { baseDate } = activityWindow([
      ...users.map((user) => user.signupDate),
      ...activities.map((row) => row.timestamp),
    ]);

    const payload = parseTool(
      await handleStdioToolCall("get_activity", { workspace: WS })
    );
    const parsed = ActivityResponseSchema.parse(payload);
    expect(parsed.users.map((user) => user.personId)).toEqual(
      expected.map((user) => user.personId)
    );
    expect(parsed.users.map((user) => user.activity)).toEqual(
      expected.map((user) => user.activity)
    );
    expect(parsed.days).toBe(28);
    expect(parsed.baseDate).toBe(baseDate.toISOString());
    expect(parsed.view_url).toContain("/dashboard");
    expect(parsed.view_url).toContain(`workspace=${WS}`);
    expect(parsed.view_url).toContain("view=dotplot");
    expect(parsed.viewUrl).toBe(parsed.view_url);
  });

  it("get_sync_status returns the same freshness/sync REST uses plus view_url", async () => {
    await db.insert(schema.syncState).values({
      source: "ics",
      sourceName: "Calendar",
      lastSync: new Date("2026-08-19T18:00:00.000Z"),
      status: "success",
      workspaceId: WS,
    });
    await db.insert(schema.users).values({
      personId: `${WS}-p1`,
      name: "Stdio Live",
      platform: "web",
      signupDate: new Date("2026-01-01T00:00:00Z"),
      workspaceId: WS,
    });
    await db.insert(schema.activity).values({
      personId: `${WS}-p1`,
      timestamp: new Date("2026-01-02T00:00:00Z"),
      eventName: "song_played",
      eventClass: "core",
      workspaceId: WS,
    });

    const freshness = await loadFreshness(WS);
    const payload = parseTool(
      await handleStdioToolCall("get_sync_status", { workspace: WS })
    );
    const parsed = SyncStatusResponseSchema.parse(payload);
    expect(parsed.workspace).toBe(freshness.workspace);
    expect(parsed.lastIngest).toBe(freshness.lastIngest);
    expect(parsed.sources).toEqual(freshness.sources);
    expect(parsed.states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "ics",
          sourceName: "Calendar",
          status: "success",
        }),
      ])
    );
    expect(parsed.syncIntervalMinutes).toBe(parseSyncIntervalMinutes());
    expect(parsed.view_url).toContain("/dashboard");
    expect(parsed.view_url).toContain(`workspace=${WS}`);
    expect(parsed.viewUrl).toBe(parsed.view_url);
  });

  it("does not weaken HTTP MCP gating for live views", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_cohorts", arguments: { workspace: "live" } },
        }),
      })
    );
    expect(response.status).toBe(401);

    for (const name of ["get_activity", "get_sync_status"] as const) {
      const gated = await postMcp(
        new NextRequest("http://localhost:3000/api/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: { workspace: "live" } },
          }),
        })
      );
      expect(gated.status, `${name} live HTTP call must stay gated`).toBe(401);
    }
  });
});

describe("stdio MCP tool-list drift gate", () => {
  it("keeps every previously listed stdio tool (the list may grow)", () => {
    const listed = listStdioMcpTools().map((tool) => tool.name);
    expect(
      missingPinnedMcpTools(listed, PINNED_STDIO_MCP_TOOLS),
      "stdio tools/list silently dropped a pinned MCP tool"
    ).toEqual([]);
  });

  it("fails when a pinned tool disappears from the advertised list", () => {
    const listed = listStdioMcpTools()
      .map((tool) => tool.name)
      .filter((name) => name !== "get_activity");
    expect(missingPinnedMcpTools(listed, PINNED_STDIO_MCP_TOOLS)).toContain(
      "get_activity"
    );
  });
});
