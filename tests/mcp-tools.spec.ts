import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { callMcpTool, parseMcpPayload } from "./helpers/verify-ingest";

const SNAPSHOT = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/snapshots/mcp-tools-list.json"), "utf8")
) as {
  tools: {
    name: string;
    inputSchema?: { properties?: Record<string, unknown> };
  }[];
};

/** Output fields agents parse. Add a row when adding a tool. */
const HAPPY_PATH: Record<
  string,
  { args: Record<string, unknown>; fields: string[] }
> = {
  get_overview: { args: { workspace: "demo" }, fields: ["totalUsers", "viewUrl"] },
  query_users: {
    args: { workspace: "demo", limit: 10 },
    fields: ["users", "viewUrl", "view_url"],
  },
  get_cohorts: {
    args: { workspace: "demo" },
    fields: ["cohorts", "smilingCount", "pmfForming", "payers", "viewUrl"],
  },
  get_wbr: { args: { workspace: "demo" }, fields: ["metrics", "exceptions", "viewUrl"] },
  get_calendar: {
    args: { workspace: "demo" },
    fields: ["events", "viewUrl"],
  },
};

test("tools/list matches the schema snapshot", async ({ request }) => {
  const response = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { result?: { tools?: unknown } };
  expect(
    body.result?.tools,
    "MCP tools/list drifted from tests/snapshots/mcp-tools-list.json"
  ).toEqual(SNAPSHOT.tools);
});

test("every advertised tool has a happy-path call that returns its fields", async ({
  request,
}) => {
  const advertised = SNAPSHOT.tools.map((tool) => tool.name);
  expect(advertised.sort()).toEqual(Object.keys(HAPPY_PATH).sort());

  for (const tool of SNAPSHOT.tools) {
    const happy = HAPPY_PATH[tool.name];
    expect(happy, `add HAPPY_PATH args and fields for ${tool.name}`).toBeDefined();

    const { response, body } = await callMcpTool(request, tool.name, happy.args);
    expect(response.ok(), `${tool.name} HTTP ${response.status()}`).toBeTruthy();

    const payload = parseMcpPayload(body);
    for (const field of happy.fields) {
      expect(payload, `${tool.name} missing field ${field}`).toHaveProperty(field);
    }
    expect(String(payload.viewUrl)).toContain("/dashboard");
  }
});

test("query_users honors advertised platform + limit fields", async ({ request }) => {
  const { response, body } = await callMcpTool(request, "query_users", {
    workspace: "demo",
    platform: "ios",
    limit: 5,
  });
  expect(response.ok()).toBeTruthy();
  const payload = parseMcpPayload(body);
  const users = payload.users as {
    personId: string;
    platform?: string;
    view_url?: string;
  }[];
  expect(Array.isArray(users)).toBeTruthy();
  expect(users.length).toBeGreaterThan(0);
  expect(users.length).toBeLessThanOrEqual(5);
  for (const user of users) {
    expect(user.platform).toBe("ios");
    expect(user.view_url).toContain(`user=${user.personId}`);
  }
});

test("get_overview and get_cohorts return demo facts agents rely on", async ({
  request,
}) => {
  const overview = parseMcpPayload(
    (await callMcpTool(request, "get_overview", { workspace: "demo" })).body
  );
  expect(overview.totalUsers).toEqual(expect.any(Number));
  expect(overview.totalUsers as number).toBeGreaterThan(36);

  const cohorts = parseMcpPayload(
    (await callMcpTool(request, "get_cohorts", { workspace: "demo" })).body
  );
  expect(Array.isArray(cohorts.cohorts)).toBeTruthy();
  expect((cohorts.cohorts as unknown[]).length).toBeGreaterThan(0);
  expect(cohorts.smilingCount).toEqual(expect.any(Number));
  expect(typeof cohorts.pmfForming).toBe("boolean");
});
