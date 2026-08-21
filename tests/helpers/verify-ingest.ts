import { expect, type APIRequestContext } from "@playwright/test";

export type IngestProbe = {
  userId: string;
  platform: string;
  workspace?: string;
  /** Required for non-demo workspaces. */
  apiKey?: string;
};

type McpCallBody = {
  result?: {
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { message?: string };
};

export function personIdFor(userId: string): string {
  return `person_${userId}`;
}

export function parseMcpPayload(body: McpCallBody): Record<string, unknown> {
  expect(body.error, body.error?.message ?? "MCP JSON-RPC error").toBeUndefined();
  expect(body.result?.isError).not.toBe(true);
  const text = body.result?.content?.[0]?.text;
  expect(text, "tool result missing text content").toBeTruthy();
  return JSON.parse(text as string) as Record<string, unknown>;
}

export async function callMcpTool(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
  headers?: Record<string, string>
) {
  const response = await request.post("/api/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  return { response, body: (await response.json()) as McpCallBody };
}

/**
 * Prove an SDK identify/track landed: REST /api/v1/users and MCP query_users
 * must both return the person. Unique `platform` is the locator.
 */
export async function expectUserVisibleViaRestAndMcp(
  request: APIRequestContext,
  probe: IngestProbe
): Promise<void> {
  const workspace = probe.workspace ?? "demo";
  const personId = personIdFor(probe.userId);
  const headers = probe.apiKey
    ? { Authorization: `Bearer ${probe.apiKey}` }
    : undefined;

  const users = await request.get(
    `/api/v1/users?workspace=${workspace}&platform=${encodeURIComponent(probe.platform)}`,
    headers ? { headers } : undefined
  );
  expect(users.ok(), `GET /api/v1/users failed: ${users.status()}`).toBeTruthy();
  const restBody = (await users.json()) as { users?: { personId: string }[] };
  expect(restBody.users?.map((user) => user.personId)).toContain(personId);

  const { response, body } = await callMcpTool(
    request,
    "query_users",
    {
      workspace,
      platform: probe.platform,
      limit: 20,
    },
    headers
  );
  expect(response.ok(), `MCP query_users failed: ${response.status()}`).toBeTruthy();
  const payload = parseMcpPayload(body);
  const mcpUsers = payload.users as { personId?: string }[] | undefined;
  expect(Array.isArray(mcpUsers)).toBeTruthy();
  expect(mcpUsers?.map((user) => user.personId)).toContain(personId);
}
