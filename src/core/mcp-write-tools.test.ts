import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import { GET as getAudit } from "@/app/api/v1/audit/route";
import { AUDIT_ACTIONS } from "@/core/audit";
import { READ_KEY_WRITE_ERROR } from "@/core/auth";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadSourceCiphertext, loadSourceConfig } from "@/core/sources";
import { MCP_WRITE_TOOL_NAMES } from "@/core/mcp-write-tools";
import { registry } from "@/connectors";

const ADMIN = "mcp-write-admin";
const WS = "mcp-write";
const SECRET = "ics://mcp-write-must-not-leak";

const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;
const originalPosthogSync = registry.posthog.sync;

afterEach(async () => {
  registry.posthog.sync = originalPosthogSync;
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  vi.unstubAllEnvs();
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
});

function asBearer(
  url: string,
  key: string,
  body: unknown,
  method = "POST"
) {
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function withAdmin() {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
}

function mcpCall(name: string, args: Record<string, unknown>, key: string) {
  return asBearer("http://localhost:3000/api/mcp", key, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

async function mintKey(scope: "read" | "write") {
  withAdmin();
  const created = await createKey(
    asBearer("http://localhost:3000/api/v1/keys", ADMIN, {
      name: `mcp-${scope}`,
      scope,
      workspace: WS,
    })
  );
  expect(created.status).toBe(201);
  return created.json() as Promise<{ id: string; key: string }>;
}

async function parseTool(response: Response) {
  const body = (await response.json()) as {
    result?: { content?: { text?: string }[]; isError?: boolean };
    error?: unknown;
  };
  expect(body.error).toBeUndefined();
  const text = body.result?.content?.[0]?.text;
  expect(text).toBeTruthy();
  return {
    isError: body.result?.isError === true,
    payload: JSON.parse(text as string) as Record<string, unknown>,
  };
}

async function queryAudit() {
  withAdmin();
  const url = new URL("http://localhost:3000/api/v1/audit");
  url.searchParams.set("workspace", WS);
  url.searchParams.set("action", AUDIT_ACTIONS.mcpCall);
  const response = await getAudit(asBearer(url.toString(), ADMIN, undefined, "GET"));
  expect(response.status).toBe(200);
  return response.json() as Promise<{
    total: number;
    entries: Array<{ actor: string; action: string; subject: string }>;
  }>;
}

const CALLS: Record<
  (typeof MCP_WRITE_TOOL_NAMES)[number],
  Record<string, unknown>
> = {
  connect_source: {
    workspace: WS,
    source: "ics",
    credentials: { icsUrl: SECRET },
  },
  trigger_sync: {
    workspace: WS,
    source: "posthog",
  },
  import_csv: {
    workspace: WS,
    kind: "users",
    csv: "person_id,name\nmcp_write_ada,Ada\n",
  },
};

describe("MCP write tools require write scope", () => {
  it.each(MCP_WRITE_TOOL_NAMES)(
    "%s refuses a read key with 403",
    async (name) => {
      const { key } = await mintKey("read");
      const response = await postMcp(mcpCall(name, CALLS[name], key));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: READ_KEY_WRITE_ERROR });

      const listed = await queryAudit();
      expect(listed.entries.map((row) => row.subject)).not.toContain(name);
    }
  );
});

describe("MCP write tools return view_url and land in the audit log", () => {
  it("connect_source stores ciphertext, never echoes credentials, and audits", async () => {
    const { id, key } = await mintKey("write");
    const response = await postMcp(mcpCall("connect_source", CALLS.connect_source, key));
    expect(response.status).toBe(200);
    const { isError, payload } = await parseTool(response);
    expect(isError).toBe(false);
    expect(payload).toEqual(
      expect.objectContaining({
        source: "ics",
        workspaceId: WS,
        connected: true,
        rotated: false,
      })
    );
    expect(String(payload.viewUrl)).toContain("/dashboard");
    expect(String(payload.viewUrl)).toContain(`workspace=${WS}`);
    expect(payload.view_url).toBe(payload.viewUrl);
    expect(JSON.stringify(payload)).not.toContain(SECRET);

    const ciphertext = await loadSourceCiphertext(WS, "ics");
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(SECRET);
    const stored = await loadSourceConfig(WS, "ics");
    expect(stored).toEqual({ icsUrl: SECRET });

    const listed = await queryAudit();
    expect(listed.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: id,
          action: AUDIT_ACTIONS.mcpCall,
          subject: "connect_source",
        }),
      ])
    );
  });

  it("trigger_sync runs ANY-16 and audits", async () => {
    registry.posthog.sync = async () => ({
      rowsSynced: 0,
      nextCursor: null,
      health: "ok",
    });
    const { id, key } = await mintKey("write");
    const response = await postMcp(mcpCall("trigger_sync", CALLS.trigger_sync, key));
    expect(response.status).toBe(200);
    const { isError, payload } = await parseTool(response);
    expect(isError).toBe(false);
    expect(payload.workspace).toBe(WS);
    expect(payload.results).toEqual([
      expect.objectContaining({ source: "posthog", health: "ok" }),
    ]);
    expect(String(payload.viewUrl)).toContain("/dashboard");
    expect(String(payload.view_url)).toContain(`workspace=${WS}`);

    const listed = await queryAudit();
    expect(listed.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: id,
          action: AUDIT_ACTIONS.mcpCall,
          subject: "trigger_sync",
        }),
      ])
    );
  });

  it("import_csv feeds ANY-12 and audits", async () => {
    const { id, key } = await mintKey("write");
    const response = await postMcp(mcpCall("import_csv", CALLS.import_csv, key));
    expect(response.status).toBe(200);
    const { isError, payload } = await parseTool(response);
    expect(isError).toBe(false);
    expect(payload).toEqual(
      expect.objectContaining({
        workspaceId: WS,
        kind: "users",
        imported: 1,
        skipped: 0,
      })
    );
    expect(String(payload.viewUrl)).toContain("/dashboard");
    expect(String(payload.view_url)).toContain(`view=dotplot`);

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    expect(users.map((row) => row.personId)).toContain("mcp_write_ada");

    const listed = await queryAudit();
    expect(listed.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: id,
          action: AUDIT_ACTIONS.mcpCall,
          subject: "import_csv",
        }),
      ])
    );
  });
});
