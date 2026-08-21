import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postMcp } from "@/app/api/mcp/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { decodeViewState } from "@/core/view-state";
import { handleStdioToolCall } from "./server";

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
  });
});
