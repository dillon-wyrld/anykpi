import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { GET as getCohorts } from "@/app/api/v1/cohorts/route";
import { POST as postMcp } from "@/app/api/mcp/route";

const WS = "compare-api";
const ANCHOR = new Date("2026-08-19T00:00:00.000Z");

const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) {
    delete process.env.ANYKPI_API_KEY;
  } else {
    process.env.ANYKPI_API_KEY = originalKey;
  }
  vi.unstubAllEnvs();
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
});

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

const AUTH = { authorization: "Bearer test-operator" };

async function seedSplitUsers() {
  const rows = [
    { personId: `${WS}-ios-1`, platform: "ios", country: "US", cluster: "power" },
    { personId: `${WS}-ios-2`, platform: "ios", country: "US", cluster: "power" },
    { personId: `${WS}-and-1`, platform: "android", country: "GB", cluster: "weekday" },
    { personId: `${WS}-web-1`, platform: "web", country: "DE", cluster: "occasional" },
    { personId: `${WS}-desk-1`, platform: "desktop", country: "FR", cluster: "fading" },
  ];
  await db.insert(schema.users).values(
    rows.map((row, i) => ({
      ...row,
      name: row.personId,
      signupDate: new Date(ANCHOR.getTime() - (4 - i) * 7 * 86400000),
      workspaceId: WS,
    }))
  );
  await db.insert(schema.activity).values(
    rows.map((row) => ({
      personId: row.personId,
      timestamp: ANCHOR,
      eventName: "core",
      eventClass: "core",
      workspaceId: WS,
    }))
  );
}

describe("GET /api/v1/cohorts compare split", () => {
  it("accepts the same split as the URL and returns at most three series", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANYKPI_API_KEY", "test-operator");
    await seedSplitUsers();

    const response = await getCohorts(
      get(`http://localhost:3000/api/v1/cohorts?workspace=${WS}&split=platform`, AUTH)
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      split: string | null;
      series: { key: string; size: number; cohorts: unknown[] }[];
      view_url: string;
    };

    expect(body.split).toBe("platform");
    expect(body.series).toHaveLength(3);
    expect(body.series.map((s) => s.key)).toEqual(["ios", "android", "desktop"]);
    expect(body.series[0].size).toBe(2);
    expect(body.view_url).toContain("view=cohorts");
    expect(body.view_url).toContain("split=platform");
  });

  it("refuses a fourth series", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANYKPI_API_KEY", "test-operator");
    await seedSplitUsers();

    const response = await getCohorts(
      get(
        `http://localhost:3000/api/v1/cohorts?workspace=${WS}&split=platform&series=ios,android,web,desktop`,
        AUTH
      )
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/capped at 3 series/i);
  });
});

describe("get_cohorts MCP split", () => {
  it("accepts split on tools/call", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANYKPI_API_KEY", "test-operator");
    await seedSplitUsers();

    const response = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", ...AUTH },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "get_cohorts",
            arguments: { workspace: WS, split: "platform" },
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    const envelope = (await response.json()) as {
      result?: { content?: { text?: string }[] };
    };
    const payload = JSON.parse(envelope.result?.content?.[0]?.text ?? "{}") as {
      split: string | null;
      series: { key: string }[];
      viewUrl: string;
    };
    expect(payload.split).toBe("platform");
    expect(payload.series).toHaveLength(3);
    expect(payload.viewUrl).toContain("split=platform");
  });
});
