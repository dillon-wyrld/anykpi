import { test, expect } from "@playwright/test";

const API_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";
const WS = "e2e-sched-unhealthy";

/**
 * A failing source must be visible on GET /api/v1/overview (and
 * get_overview). /connect renders that state as human copy (ANY-19).
 *
 * The short-interval "data no older than 20 minutes" path lives in
 * `src/core/scheduler.test.ts` so it can use recorded fixtures without
 * a second Next server.
 */
test("a failing source is unhealthy in get_overview", async ({ request }) => {
  const triggered = await request.post("/api/v1/sync", {
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
    },
    data: { workspace: WS, source: "mixpanel" },
  });
  expect(triggered.ok(), `sync trigger failed: ${triggered.status()}`).toBeTruthy();

  const overview = await request.get(`/api/v1/overview?workspace=${WS}`, {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  expect(overview.ok()).toBeTruthy();
  const body = (await overview.json()) as {
    syncHealth?: { source: string; status: string }[];
  };
  expect(body.syncHealth).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "mixpanel", status: "error" }),
    ])
  );

  const mcp = await request.post("/api/mcp", {
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_overview",
        arguments: { workspace: WS },
      },
    },
  });
  expect(mcp.ok()).toBeTruthy();
  const mcpBody = (await mcp.json()) as {
    result?: { content?: { text?: string }[] };
  };
  const payload = JSON.parse(mcpBody.result?.content?.[0]?.text ?? "{}") as {
    syncHealth?: { source: string; status: string }[];
  };
  expect(payload.syncHealth).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: "mixpanel", status: "error" }),
    ])
  );
});
