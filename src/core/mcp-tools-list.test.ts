import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as postMcp } from "@/app/api/mcp/route";

const SNAPSHOT_PATH = resolve(__dirname, "../../tests/snapshots/mcp-tools-list.json");

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string }>;
  };
};

async function listTools() {
  const response = await postMcp(
    new NextRequest("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    })
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result?: { tools?: McpTool[] };
    error?: unknown;
  };
  expect(body.error, "tools/list must stay unauthenticated and succeed").toBeUndefined();
  return body.result?.tools ?? [];
}

describe("MCP tools/list schema snapshot", () => {
  it("matches the checked-in snapshot so renaming a tool or field fails CI", async () => {
    const listed = await listTools();
    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as {
      tools: McpTool[];
    };

    expect(
      listed,
      `MCP tools/list drifted from ${SNAPSHOT_PATH}. Updating that snapshot is part of any tool-adding ticket.`
    ).toEqual(snapshot.tools);
  });

  it("advertises a name and inputSchema.properties for every tool", async () => {
    const listed = await listTools();
    expect(listed.length).toBeGreaterThan(0);

    for (const tool of listed) {
      expect(tool.name, "every tool needs a stable name").toMatch(/^[a-z]+_[a-z0-9_]+$/);
      expect(tool.inputSchema?.type).toBe("object");
      expect(
        tool.inputSchema?.properties,
        `${tool.name} is missing inputSchema.properties`
      ).toEqual(expect.any(Object));
    }
  });
});

function callRequest(name: string, args: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const response = await postMcp(callRequest(name, args));
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result?: { content?: { text?: string }[]; isError?: boolean };
    error?: unknown;
  };
  expect(body.error).toBeUndefined();
  expect(body.result?.isError).not.toBe(true);
  const text = body.result?.content?.[0]?.text;
  expect(text).toBeTruthy();
  return JSON.parse(text as string) as Record<string, unknown>;
}

describe("MCP tool output fields (empty fixture DB)", () => {
  it("get_overview returns totalUsers and viewUrl", async () => {
    const payload = await callTool("get_overview", { workspace: "demo" });
    expect(payload).toEqual(
      expect.objectContaining({
        totalUsers: expect.any(Number),
        viewUrl: expect.stringContaining("/dashboard"),
        syncHealth: expect.any(Array),
        presence: expect.objectContaining({
          online: expect.any(Number),
          cities: expect.any(Array),
        }),
      })
    );
  });

  it("query_users returns users and viewUrl", async () => {
    const payload = await callTool("query_users", {
      workspace: "demo",
      platform: "ios",
      limit: 3,
    });
    expect(Array.isArray(payload.users)).toBe(true);
    expect(payload.viewUrl).toEqual(expect.stringContaining("/dashboard"));
    expect(payload.view_url).toEqual(expect.stringContaining("/dashboard"));
    for (const user of payload.users as { personId: string; view_url?: string }[]) {
      expect(user.view_url).toContain(`user=${user.personId}`);
    }
  });
});
