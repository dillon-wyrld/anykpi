import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postMcp } from "@/app/api/mcp/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import {
  GET as getAnnotations,
  POST as postAnnotation,
} from "@/app/api/v1/annotations/route";
import { READ_KEY_WRITE_ERROR } from "@/core/auth";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import {
  createAnnotation,
  persistTargetType,
  normalizeTargetId,
} from "@/core/annotations";

const ADMIN = "annotate-admin";
const WS = "annotate-ws";

const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.ANYKPI_SECRET;
  else process.env.ANYKPI_SECRET = originalSecret;
  vi.unstubAllEnvs();
  await db.delete(schema.annotations).where(eq(schema.annotations.workspaceId, WS));
  await db.delete(schema.annotations).where(eq(schema.annotations.workspaceId, `${WS}-h`));
  await db.delete(schema.annotations).where(eq(schema.annotations.workspaceId, `${WS}-a`));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, `${WS}-a`));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, WS));
  await db.delete(schema.auditLog).where(eq(schema.auditLog.workspaceId, WS));
});

function asBearer(url: string, key: string, body?: unknown, method = "POST") {
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

describe("annotation target normalization", () => {
  it("stores user as person so tombstones stay honest", () => {
    expect(persistTargetType("user")).toBe("person");
    expect(persistTargetType("person")).toBe("person");
    expect(persistTargetType("date")).toBe("date");
  });

  it("normalizes a datetime to YYYY-MM-DD", () => {
    expect(normalizeTargetId("date", "2026-08-21T12:00:00.000Z")).toBe("2026-08-21");
    expect(normalizeTargetId("date", "2026-08-21")).toBe("2026-08-21");
  });
});

describe("agent annotate is indistinguishable from the human write", () => {
  it("produces the same annotations row", async () => {
    withAdmin();
    const body = {
      type: "note" as const,
      targetType: "person" as const,
      targetId: "person_ada",
      content: "Came back after two quiet weeks",
    };
    const human = await createAnnotation(`${WS}-h`, body);
    const minted = await createKey(
      asBearer("http://localhost:3000/api/v1/keys", ADMIN, {
        name: "agent",
        scope: "write",
        workspace: `${WS}-a`,
      })
    );
    expect(minted.status).toBe(201);
    const { key } = (await minted.json()) as { key: string };
    const mcp = await postMcp(
      asBearer("http://localhost:3000/api/mcp", key, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "annotate",
          arguments: { ...body, workspace: `${WS}-a` },
        },
      })
    );
    expect(mcp.status).toBe(200);
    const agentRows = await db
      .select()
      .from(schema.annotations)
      .where(eq(schema.annotations.workspaceId, `${WS}-a`))
      .all();
    const humanRows = await db
      .select()
      .from(schema.annotations)
      .where(eq(schema.annotations.workspaceId, `${WS}-h`))
      .all();
    expect(agentRows).toHaveLength(1);
    expect(humanRows).toHaveLength(1);
    const strip = (row: (typeof agentRows)[0]) => ({
      type: row.type,
      targetType: row.targetType,
      targetId: row.targetId,
      content: row.content,
    });
    expect(strip(agentRows[0])).toEqual(strip(humanRows[0]));
    expect(human.targetType).toBe("person");
    expect(human.content).toBe(body.content);
  });
});

describe("REST annotate", () => {
  it("refuses a read key and writes the same row GET can list", async () => {
    withAdmin();
    const read = await createKey(
      asBearer("http://localhost:3000/api/v1/keys", ADMIN, {
        name: "reader",
        scope: "read",
        workspace: WS,
      })
    );
    const { key: readKey } = (await read.json()) as { key: string };
    const refused = await postAnnotation(
      asBearer("http://localhost:3000/api/v1/annotations", readKey, {
        workspace: WS,
        type: "sticker",
        targetType: "user",
        targetId: "person_ada",
        content: "🎂",
      })
    );
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: READ_KEY_WRITE_ERROR });

    const created = await postAnnotation(
      asBearer("http://localhost:3000/api/v1/annotations", ADMIN, {
        workspace: WS,
        type: "sticker",
        targetType: "user",
        targetId: "person_ada",
        content: "🎂",
      })
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      annotation: { targetType: string; content: string };
      view_url: string;
    };
    expect(body.annotation.targetType).toBe("person");
    expect(body.annotation.content).toBe("🎂");
    expect(body.view_url).toContain("view=dotplot");

    const listed = await getAnnotations(
      asBearer(
        `http://localhost:3000/api/v1/annotations?workspace=${WS}`,
        ADMIN,
        undefined,
        "GET"
      )
    );
    expect(listed.status).toBe(200);
    const page = (await listed.json()) as {
      annotations: { content: string; targetType: string }[];
    };
    expect(page.annotations).toEqual([
      expect.objectContaining({ content: "🎂", targetType: "person" }),
    ]);
  });
});
