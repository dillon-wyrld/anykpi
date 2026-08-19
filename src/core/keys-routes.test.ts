import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { READ_KEY_WRITE_ERROR } from "@/core/auth";
import { GET as listKeys, POST as createKey } from "@/app/api/v1/keys/route";
import { DELETE as deleteKey } from "@/app/api/v1/keys/[id]/route";
import { POST as downgradeKeys } from "@/app/api/v1/keys/downgrade/route";
import { POST as postEvent } from "@/app/api/ingest/event/route";

const ADMIN = "admin-secret";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
});

function asBearer(url: string, method: string, key: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function asAdmin(url: string, method: string, body?: unknown) {
  return asBearer(url, method, ADMIN, body);
}

describe("API key revocation", () => {
  it("mints a key, then revokes it (200), and unknown ids 404", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const created = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", { name: "revoke-me" })
    );
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect(id).toMatch(/^ak_/);

    const revoked = await deleteKey(
      asAdmin(`http://localhost:3000/api/v1/keys/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) }
    );
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).revoked).toBe(true);

    const missing = await deleteKey(
      asAdmin("http://localhost:3000/api/v1/keys/ak_does_not_exist", "DELETE"),
      { params: Promise.resolve({ id: "ak_does_not_exist" }) }
    );
    expect(missing.status).toBe(404);
  });

  it("rejects unauthenticated revocation with 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const res = await deleteKey(
      new NextRequest("http://localhost:3000/api/v1/keys/ak_x", { method: "DELETE" }),
      { params: Promise.resolve({ id: "ak_x" }) }
    );
    expect(res.status).toBe(401);
  });
});

describe("API key scopes", () => {
  it("mints a new key as read by default", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const created = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", { name: "reader" })
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.scope).toBe("read");
    expect(body.legacy).toBe(false);
    expect(body.key).toMatch(/^ak_/);

    const listed = await listKeys(asAdmin("http://localhost:3000/api/v1/keys", "GET"));
    expect(listed.status).toBe(200);
    const { keys } = (await listed.json()) as {
      keys: Array<{ id: string; scope: string; legacy: boolean }>;
    };
    const minted = keys.find((k) => k.id === body.id);
    expect(minted?.scope).toBe("read");
    expect(minted?.legacy).toBe(false);
  });

  it("rejects a read key on a write with 403 and a plain-language error", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const created = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", { name: "read-only" })
    );
    const { key } = await created.json();
    expect(typeof key).toBe("string");

    const write = await postEvent(
      asBearer("http://localhost:3000/api/ingest/event", "POST", key, {
        userId: "scope-denied",
        eventName: "song_played",
        workspaceId: "live",
      })
    );
    expect(write.status).toBe(403);
    const denied = await write.json();
    expect(denied.error).toBe(READ_KEY_WRITE_ERROR);
    expect(denied.error).toMatch(/read/i);
  });

  it("marks migrated keys as legacy write and downgrades them in one command", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const id = `ak_legacy_${Date.now()}`;
    await db.insert(schema.apiKeys).values({
      id,
      hashedKey: "not-a-real-hash",
      name: "pre-scope key",
      workspaceId: "live",
      createdAt: new Date(),
      scope: "write",
      legacy: true,
    });

    const listed = await listKeys(asAdmin("http://localhost:3000/api/v1/keys", "GET"));
    const { keys } = (await listed.json()) as {
      keys: Array<{ id: string; scope: string; legacy: boolean }>;
    };
    const migrated = keys.find((k) => k.id === id);
    expect(migrated).toEqual(expect.objectContaining({ id, scope: "write", legacy: true }));

    const downgraded = await downgradeKeys(
      asAdmin("http://localhost:3000/api/v1/keys/downgrade", "POST", {})
    );
    expect(downgraded.status).toBe(200);
    expect((await downgraded.json()).downgraded).toContain(id);

    const after = await listKeys(asAdmin("http://localhost:3000/api/v1/keys", "GET"));
    const again = ((await after.json()) as { keys: Array<{ id: string; scope: string; legacy: boolean }> })
      .keys.find((k) => k.id === id);
    expect(again).toEqual(expect.objectContaining({ id, scope: "read", legacy: false }));

    await db.delete(schema.apiKeys).where(eq(schema.apiKeys.id, id));
  });

  it("records lastUsedAt when a hashed key is presented", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const created = await createKey(
      asAdmin("http://localhost:3000/api/v1/keys", "POST", { name: "last-used" })
    );
    const { id, key } = await created.json();

    const used = await listKeys(asBearer("http://localhost:3000/api/v1/keys", "GET", key));
    expect(used.status).toBe(200);

    const listed = await listKeys(asAdmin("http://localhost:3000/api/v1/keys", "GET"));
    const row = (
      (await listed.json()) as { keys: Array<{ id: string; lastUsedAt: string | null }> }
    ).keys.find((k) => k.id === id);
    expect(row?.lastUsedAt).toMatch(/^\d{4}-/);
  });
});

describe("ingest body-size bound", () => {
  it("rejects an oversized event body with 413", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const huge = { userId: "u", event: "e", workspaceId: "live", properties: { blob: "A".repeat(70000) } };
    const res = await postEvent(
      asAdmin("http://localhost:3000/api/ingest/event", "POST", huge)
    );
    expect(res.status).toBe(413);
  });
});
