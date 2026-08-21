import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { POST as postIdentify } from "@/app/api/ingest/identify/route";
import { GET as getUsers } from "@/app/api/v1/users/route";
import { POST as createKey } from "@/app/api/v1/keys/route";
import {
  DELETE as deleteWorkspaceRoute,
  POST as createWorkspace,
} from "@/app/api/v1/workspaces/route";
import { GET as getDotplot } from "@/app/api/views/dotplot/route";
import { db } from "./db";
import * as schema from "./schema";
import { upsertConfig } from "./upsert";

const ADMIN = "iso-admin-key";
const A = "iso-a";
const B = "iso-b";
const DISTINCT = "shared-distinct";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.users).where(eq(schema.users.workspaceId, A));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, B));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, A));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, B));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, A));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, B));
  await db.delete(schema.annotations).where(eq(schema.annotations.workspaceId, A));
  await db.delete(schema.annotations).where(eq(schema.annotations.workspaceId, B));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, A));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, B));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, A));
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, B));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, A));
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, B));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, A));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, B));
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

function asKey(url: string, key: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? "GET" : "DELETE",
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function mintWriteKey(workspace: string, name: string): Promise<string> {
  const created = await createKey(
    asAdmin("http://localhost:3000/api/v1/keys", "POST", {
      name,
      scope: "write",
      workspace,
    })
  );
  expect(created.status).toBe(201);
  const body = (await created.json()) as { key: string };
  return body.key;
}

describe("ANY-39 workspace isolation", () => {
  it("the same distinct_id ingested into two workspaces yields two rows", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const first = await postIdentify(
      asAdmin("http://localhost:3000/api/ingest/identify", "POST", {
        userId: DISTINCT,
        workspaceId: A,
        properties: { name: "Ada Alpha", platform: "ios" },
      })
    );
    const second = await postIdentify(
      asAdmin("http://localhost:3000/api/ingest/identify", "POST", {
        userId: DISTINCT,
        workspaceId: B,
        properties: { name: "Ada Beta", platform: "android" },
      })
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.personId, `person_${DISTINCT}`))
      .all();
    const isolated = rows.filter((row) => row.workspaceId === A || row.workspaceId === B);
    expect(isolated).toHaveLength(2);
    expect(isolated.find((row) => row.workspaceId === A)?.name).toBe("Ada Alpha");
    expect(isolated.find((row) => row.workspaceId === B)?.name).toBe("Ada Beta");
  });

  it("config writes stay separate per workspace", async () => {
    await upsertConfig({
      key: "value_events",
      value: JSON.stringify({ core: "alpha_played" }),
      workspaceId: A,
    });
    await upsertConfig({
      key: "value_events",
      value: JSON.stringify({ core: "beta_played" }),
      workspaceId: B,
    });
    await upsertConfig({
      key: "value_events",
      value: JSON.stringify({ core: "alpha_updated" }),
      workspaceId: A,
    });

    const alpha = await db
      .select()
      .from(schema.config)
      .where(
        and(eq(schema.config.workspaceId, A), eq(schema.config.key, "value_events"))
      )
      .get();
    const beta = await db
      .select()
      .from(schema.config)
      .where(
        and(eq(schema.config.workspaceId, B), eq(schema.config.key, "value_events"))
      )
      .get();

    expect(alpha?.value).toBe(JSON.stringify({ core: "alpha_updated" }));
    expect(beta?.value).toBe(JSON.stringify({ core: "beta_played" }));
  });

  it("a workspace-bound key cannot read another live workspace", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: A,
        name: "Isolation A",
      })
    );
    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: B,
        name: "Isolation B",
      })
    );

    const keyA = await mintWriteKey(A, "iso-a-key");
    const keyB = await mintWriteKey(B, "iso-b-key");

    await postIdentify(
      asAdmin("http://localhost:3000/api/ingest/identify", "POST", {
        userId: DISTINCT,
        workspaceId: A,
        properties: { name: "Only Alpha", platform: "iso-a" },
      })
    );
    await postIdentify(
      asAdmin("http://localhost:3000/api/ingest/identify", "POST", {
        userId: DISTINCT,
        workspaceId: B,
        properties: { name: "Only Beta", platform: "iso-b" },
      })
    );

    const usersA = await getUsers(
      asKey(`http://localhost:3000/api/v1/users?workspace=${A}&platform=iso-a`, keyA)
    );
    const usersB = await getUsers(
      asKey(`http://localhost:3000/api/v1/users?workspace=${B}&platform=iso-b`, keyB)
    );
    const leak = await getUsers(
      asKey(`http://localhost:3000/api/v1/users?workspace=${B}`, keyA)
    );

    expect(usersA.status).toBe(200);
    expect(usersB.status).toBe(200);
    expect(leak.status).toBe(401);

    const bodyA = (await usersA.json()) as { users: { name: string }[] };
    expect(bodyA.users.map((user) => user.name)).toContain("Only Alpha");
    expect(bodyA.users.map((user) => user.name)).not.toContain("Only Beta");

    const viewA = await getDotplot(
      asKey(`http://localhost:3000/api/views/dotplot?workspace=${A}`, keyA)
    );
    const viewCross = await getDotplot(
      asKey(`http://localhost:3000/api/views/dotplot?workspace=${B}`, keyA)
    );
    expect(viewA.status).toBe(200);
    expect(viewCross.status).toBe(401);
  });

  it("deleting workspace A never touches workspace B", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: A,
        name: "Isolation A",
      })
    );
    await createWorkspace(
      asAdmin("http://localhost:3000/api/v1/workspaces", "POST", {
        id: B,
        name: "Isolation B",
      })
    );

    for (const ws of [A, B]) {
      await db.insert(schema.users).values({
        personId: `person_${ws}`,
        name: `User ${ws}`,
        email: `${ws}@example.com`,
        workspaceId: ws,
      });
      await db.insert(schema.activity).values({
        personId: `person_${ws}`,
        timestamp: new Date("2026-03-01T00:00:00.000Z"),
        eventName: "song_played",
        eventClass: "core",
        externalId: `evt-${ws}`,
        workspaceId: ws,
      });
      await db.insert(schema.config).values({
        key: "value_events",
        value: JSON.stringify({ core: ws }),
        workspaceId: ws,
      });
      await db.insert(schema.annotations).values({
        type: "note",
        targetType: "person",
        targetId: `person_${ws}`,
        content: `note-${ws}`,
        createdAt: new Date(),
        workspaceId: ws,
      });
      await db.insert(schema.syncState).values({
        source: "ics",
        sourceName: "ICS",
        status: "success",
        workspaceId: ws,
      });
      await db.insert(schema.sources).values({
        workspaceId: ws,
        source: "ics",
        config: `cipher-${ws}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const keyA = await mintWriteKey(A, "iso-a-delete");
    const leak = await deleteWorkspaceRoute(
      asKey("http://localhost:3000/api/v1/workspaces", keyA, {
        id: B,
        name: "Isolation B",
      })
    );
    expect(leak.status).toBe(401);

    const deleted = await deleteWorkspaceRoute(
      asAdmin("http://localhost:3000/api/v1/workspaces", "DELETE", {
        id: A,
        name: "Isolation A",
      })
    );
    expect(deleted.status).toBe(200);

    expect(
      await db.select().from(schema.users).where(eq(schema.users.workspaceId, A)).all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.workspaceId, A))
        .all()
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.config).where(eq(schema.config.workspaceId, A)).all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.annotations)
        .where(eq(schema.annotations.workspaceId, A))
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.syncState)
        .where(eq(schema.syncState.workspaceId, A))
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.workspaceId, A))
        .all()
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.apiKeys)
        .where(eq(schema.apiKeys.workspaceId, A))
        .all()
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, A)).get()
    ).toBeUndefined();

    const userB = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.workspaceId, B))
      .get();
    expect(userB?.name).toBe("User iso-b");
    const activityB = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, B))
      .all();
    expect(activityB).toHaveLength(1);
    const configB = await db
      .select()
      .from(schema.config)
      .where(and(eq(schema.config.workspaceId, B), eq(schema.config.key, "value_events")))
      .get();
    expect(configB?.value).toBe(JSON.stringify({ core: B }));
    const noteB = await db
      .select()
      .from(schema.annotations)
      .where(eq(schema.annotations.workspaceId, B))
      .get();
    expect(noteB?.content).toBe("note-iso-b");
    expect(
      await db
        .select()
        .from(schema.syncState)
        .where(eq(schema.syncState.workspaceId, B))
        .get()
    ).toBeTruthy();
    expect(
      await db
        .select()
        .from(schema.sources)
        .where(eq(schema.sources.workspaceId, B))
        .get()
    ).toBeTruthy();
    expect(
      await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, B)).get()
    ).toBeTruthy();
  });
});
