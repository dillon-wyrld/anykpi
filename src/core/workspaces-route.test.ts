import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  GET as listWorkspaces,
  PATCH as archiveWorkspace,
  POST as createWorkspace,
} from "@/app/api/v1/workspaces/route";
import { db } from "./db";
import * as schema from "./schema";

const ADMIN = "workspaces-admin";
const WS = "catalog-a";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, WS));
});

function asAdmin(url: string, method: string, body?: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
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
