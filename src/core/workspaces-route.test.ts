import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { POST as postSession } from "@/app/api/session/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import {
  DELETE as deleteWorkspaceRoute,
  GET as listWorkspaces,
  PATCH as archiveWorkspace,
  POST as createWorkspace,
} from "@/app/api/v1/workspaces/route";
import { SESSION_COOKIE_NAME } from "./session";
import { db } from "./db";
import * as schema from "./schema";
import { ensureDefaultWorkspaces } from "./workspaces";
import { READ_KEY_WRITE_ERROR } from "./auth";

const ADMIN = "workspaces-admin";
const WS = "catalog-a";
const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  vi.unstubAllEnvs();
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
  await db.delete(schema.annotations).where(eq(schema.annotations.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
  await ensureDefaultWorkspaces();
});

function asAdmin(url: string, method: string, body?: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mintKey(scope: "read" | "write", workspace = WS) {
  const created = await createKey(
    asAdmin("http://localhost:3000/api/v1/keys", "POST", {
      name: `${scope}-key`,
      scope,
      workspace,
    })
  );
  expect(created.status).toBe(201);
  return created.json() as Promise<{ id: string; key: string }>;
}

describe("GET /api/v1/workspaces", () => {
  it("lists demo and live without a key", async () => {
    const response = await listWorkspaces();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspaces: { id: string }[];
    };
    expect(body.workspaces.map((row) => row.id)).toEqual(
      expect.arrayContaining(["demo", "live"])
    );
  });
});

describe("POST /api/v1/workspaces", () => {
  it("creates a live workspace for an admin key", async () => {
    const created = await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Catalog A",
      })
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { workspace: { id: string; name: string } };
    expect(body.workspace).toMatchObject({ id: WS, name: "Catalog A" });

    const listed = await listWorkspaces();
    const ids = (
      (await listed.json()) as { workspaces: { id: string }[] }
    ).workspaces.map((row) => row.id);
    expect(ids).toContain(WS);
  });

  it("refuses an unauthenticated create", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");
    const response = await createWorkspace(
      new NextRequest("http://localhost:3000/api/v1/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: WS, name: "Nope" }),
      })
    );
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/v1/workspaces", () => {
  it("refuses to archive demo", async () => {
    const response = await archiveWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "PATCH", {
        id: "demo",
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/v1/workspaces", () => {
  it("refuses a mismatched name and leaves the workspace", async () => {
    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Catalog A",
      })
    );
    const response = await deleteWorkspaceRoute(
      asAdmin("http://localhost:3000/api/v1/workspaces", "DELETE", {
        id: WS,
        name: "Wrong",
      })
    );
    expect(response.status).toBe(400);
    const row = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, WS))
      .get();
    expect(row).toBeTruthy();
  });

  it("deletes after the typed name matches and records the catalog row", async () => {
    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Catalog A",
      })
    );
    await db.insert(schema.users).values({
      personId: "person_wipe",
      name: "Ada",
      workspaceId: WS,
    });

    const response = await deleteWorkspaceRoute(
      asAdmin("http://localhost:3000/api/v1/workspaces", "DELETE", {
        id: WS,
        name: "Catalog A",
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deleted: true,
      workspace: expect.objectContaining({ id: WS, name: "Catalog A" }),
    });

    const row = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, WS))
      .get();
    expect(row).toBeUndefined();
    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, WS))
      .all();
    expect(users).toHaveLength(0);
  });

  it("refuses an unauthenticated delete and a read key", async () => {
    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Catalog A",
      })
    );

    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");
    const anon = await deleteWorkspaceRoute(
      new NextRequest("http://localhost:3000/api/v1/workspaces", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: WS, name: "Catalog A" }),
      })
    );
    expect(anon.status).toBe(401);

    const { key } = await mintKey("read");
    const read = await deleteWorkspaceRoute(
      new NextRequest("http://localhost:3000/api/v1/workspaces", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ id: WS, name: "Catalog A" }),
      })
    );
    expect(read.status).toBe(403);
    expect(await read.json()).toEqual({ error: READ_KEY_WRITE_ERROR });
  });

  it("accepts a write key bound to that workspace and a browser session", async () => {
    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Catalog A",
      })
    );
    const { key } = await mintKey("write");
    const byKey = await deleteWorkspaceRoute(
      new NextRequest("http://localhost:3000/api/v1/workspaces", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ id: WS, name: "Catalog A" }),
      })
    );
    expect(byKey.status).toBe(200);

    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: WS,
        name: "Catalog A",
      })
    );
    process.env.ANYKPI_API_KEY = ADMIN;
    process.env.ANYKPI_SECRET = "workspaces-session";
    vi.stubEnv("NODE_ENV", "test");
    const login = await postSession(
      new NextRequest("http://localhost:3000/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: ADMIN, workspace: WS }),
      })
    );
    expect(login.status).toBe(200);
    const setCookie =
      login.headers.getSetCookie?.()[0] ?? login.headers.get("set-cookie") ?? "";
    const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
    expect(match?.[1]).toBeTruthy();

    const bySession = await deleteWorkspaceRoute(
      new NextRequest("http://localhost:3000/api/v1/workspaces", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${match?.[1]}`,
        },
        body: JSON.stringify({ id: WS, name: "Catalog A" }),
      })
    );
    expect(bySession.status).toBe(200);
  });

  it("lets demo be wiped and re-seeded", async () => {
    const marker = "person_demo_reseed";
    await db
      .delete(schema.users)
      .where(
        and(eq(schema.users.workspaceId, "demo"), eq(schema.users.personId, marker))
      );
    await db.insert(schema.users).values({
      personId: marker,
      name: "Reseed",
      workspaceId: "demo",
    });

    const wiped = await deleteWorkspaceRoute(
      asAdmin("http://localhost:3000/api/v1/workspaces", "DELETE", {
        id: "demo",
        name: "Demo",
      })
    );
    expect(wiped.status).toBe(200);
    const gone = await db
      .select()
      .from(schema.users)
      .where(
        and(eq(schema.users.workspaceId, "demo"), eq(schema.users.personId, marker))
      )
      .get();
    expect(gone).toBeUndefined();

    await ensureDefaultWorkspaces();
    await db.insert(schema.users).values({
      personId: marker,
      name: "Reseed",
      workspaceId: "demo",
    });
    const back = await db
      .select()
      .from(schema.users)
      .where(
        and(eq(schema.users.workspaceId, "demo"), eq(schema.users.personId, marker))
      )
      .get();
    expect(back?.name).toBe("Reseed");
    await db
      .delete(schema.users)
      .where(
        and(eq(schema.users.workspaceId, "demo"), eq(schema.users.personId, marker))
      );
  });
});

describe("MCP cannot delete a workspace", () => {
  it("tools/list does not advertise delete_workspace", async () => {
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
      result?: { tools?: { name?: string }[] };
    };
    const names = (body.result?.tools ?? []).map((tool) => tool.name);
    expect(names).not.toContain("delete_workspace");
    expect(names.some((name) => name && /delete.*workspace|workspace.*delete/.test(name))).toBe(
      false
    );
  });

  it("tools/call refuses delete_workspace", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    const response = await postMcp(
      asAdmin("http://localhost:3000/api/mcp", "POST", {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "delete_workspace",
          arguments: { id: WS, name: "Catalog A" },
        },
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { isError?: boolean; content?: { text?: string }[] };
      error?: { message?: string };
    };
    const text = body.result?.content?.[0]?.text ?? body.error?.message ?? "";
    expect(text.toLowerCase()).toMatch(/unknown|not found|not implemented|invalid/);
  });
});
