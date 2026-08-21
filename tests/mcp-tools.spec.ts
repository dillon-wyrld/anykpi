import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { startFakeSmtp } from "./helpers/fake-smtp";
import { callMcpTool, parseMcpPayload } from "./helpers/verify-ingest";

const SNAPSHOT = JSON.parse(
  readFileSync(resolve(process.cwd(), "tests/snapshots/mcp-tools-list.json"), "utf8")
) as {
  tools: {
    name: string;
    inputSchema?: { properties?: Record<string, unknown> };
  }[];
};

const API_KEY = process.env.ANYKPI_API_KEY || "anykpi-e2e-admin";

/** Output fields agents parse. Add a row when adding a tool. */
const HAPPY_PATH: Record<
  string,
  { args: Record<string, unknown>; fields: string[]; write?: boolean }
> = {
  get_overview: { args: { workspace: "demo" }, fields: ["totalUsers", "viewUrl"] },
  query_users: {
    args: { workspace: "demo", limit: 10 },
    fields: ["users", "viewUrl", "view_url"],
  },
  get_activity: {
    args: { workspace: "demo" },
    fields: ["users", "days", "baseDate", "viewUrl", "view_url"],
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
  get_sync_status: {
    args: { workspace: "demo" },
    fields: ["lastIngest", "sources", "states", "syncIntervalMinutes", "viewUrl", "view_url"],
  },
  connect_source: {
    args: {
      workspace: "e2e-mcp-write",
      source: "ics",
      credentials: { icsUrl: "https://example.com/calendar.ics" },
    },
    fields: ["connected", "source", "workspaceId", "viewUrl", "view_url"],
    write: true,
  },
  trigger_sync: {
    args: { workspace: "e2e-mcp-write", source: "ics" },
    fields: ["results", "states", "workspace", "viewUrl"],
    write: true,
  },
  import_csv: {
    args: {
      workspace: "e2e-mcp-write",
      kind: "users",
      csv: "person_id,name\nmcp_e2e,Ada\n",
    },
    fields: ["imported", "kind", "workspaceId", "viewUrl"],
    write: true,
  },
  define_metric: {
    args: {
      workspace: "e2e-mcp-write",
      name: "Weekly actives",
      section: "eng",
      type: "input",
      source: { kind: "event_count", measure: "actives" },
    },
    fields: ["metric", "workspace", "viewUrl", "view_url"],
    write: true,
  },
  queue_outreach: {
    args: {
      workspace: "demo",
      personId: "p1",
      body: "hey Dave — 15 minutes on the product?",
    },
    fields: ["draft", "viewUrl", "view_url"],
    write: true,
  },
  approve_outreach: {
    args: { workspace: "demo", id: "" },
    fields: ["draft", "viewUrl", "view_url"],
    write: true,
  },
  send_outreach: {
    args: { workspace: "demo", id: "" },
    fields: ["draft", "delivery", "viewUrl", "view_url"],
    write: true,
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

  const smtp = await startFakeSmtp();
  let outreachId = "";
  try {
    const connected = await callMcpTool(
      request,
      "connect_source",
      {
        workspace: "demo",
        source: "smtp",
        credentials: {
          host: "127.0.0.1",
          port: String(smtp.port),
          from: "founder@example.com",
        },
      },
      { Authorization: `Bearer ${API_KEY}` }
    );
    expect(connected.response.ok(), "smtp connect for send_outreach").toBeTruthy();

    for (const tool of SNAPSHOT.tools) {
      const happy = HAPPY_PATH[tool.name];
      expect(happy, `add HAPPY_PATH args and fields for ${tool.name}`).toBeDefined();

      const args = { ...happy.args };
      if (tool.name === "approve_outreach" || tool.name === "send_outreach") {
        expect(outreachId, `${tool.name} needs a queued draft id`).toBeTruthy();
        args.id = outreachId;
      }

      const headers = happy.write
        ? { Authorization: `Bearer ${API_KEY}` }
        : undefined;
      const { response, body } = await callMcpTool(
        request,
        tool.name,
        args,
        headers
      );
      expect(response.ok(), `${tool.name} HTTP ${response.status()}`).toBeTruthy();

      const payload = parseMcpPayload(body);
      for (const field of happy.fields) {
        expect(payload, `${tool.name} missing field ${field}`).toHaveProperty(field);
      }
      expect(String(payload.viewUrl)).toContain("/dashboard");

      if (tool.name === "queue_outreach") {
        const draft = payload.draft as { id?: string };
        outreachId = draft.id ?? "";
      }
    }
  } finally {
    await smtp.close();
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
