import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getFreshness } from "@/app/api/v1/freshness/route";
import { POST as postEvent } from "@/app/api/ingest/event/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";

const ADMIN = "freshness-route-admin";
const WS = "freshness-api";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
});

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

function post(url: string, body: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("GET /api/v1/freshness auth", () => {
  it("demo remains readable without a key", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getFreshness(
      get("http://localhost:3000/api/v1/freshness?workspace=demo")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspace).toBe("demo");
    expect(body).toHaveProperty("lastIngest");
    expect(Array.isArray(body.sources)).toBe(true);
  });

  it("live requires an API key (401)", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getFreshness(
      get("http://localhost:3000/api/v1/freshness?workspace=live")
    );
    expect(response.status).toBe(401);
  });
});

describe("GET /api/v1/freshness stamps", () => {
  it("moves lastIngest after track() and lists per-source last-sync", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const syncedAt = new Date("2026-08-19T18:00:00.000Z");
    await db.insert(schema.syncState).values({
      source: "posthog",
      sourceName: "PostHog",
      lastSync: syncedAt,
      status: "success",
      workspaceId: WS,
    });

    const before = await getFreshness(
      get(`http://localhost:3000/api/v1/freshness?workspace=${WS}`, {
        authorization: `Bearer ${ADMIN}`,
      })
    );
    expect(before.status).toBe(200);
    const beforeBody = await before.json();
    expect(beforeBody.lastIngest).toBeNull();
    expect(beforeBody.sources).toEqual([
      { source: "posthog", lastSync: syncedAt.toISOString() },
    ]);

    const tracked = await postEvent(
      post(
        "http://localhost:3000/api/ingest/event",
        {
          userId: "fresh-1",
          eventName: "freshness_ping",
          workspaceId: WS,
          timestamp: "2026-08-19T19:00:00.000Z",
        },
        { authorization: `Bearer ${ADMIN}` }
      )
    );
    expect(tracked.status).toBe(200);

    const after = await getFreshness(
      get(`http://localhost:3000/api/v1/freshness?workspace=${WS}`, {
        authorization: `Bearer ${ADMIN}`,
      })
    );
    expect(after.status).toBe(200);
    const afterBody = await after.json();
    expect(afterBody.lastIngest).toEqual(
      expect.stringContaining("2026-08-19T19:00:00.000Z")
    );
    expect(afterBody.lastIngest).not.toBe(beforeBody.lastIngest);
    expect(afterBody.sources).toEqual([
      { source: "posthog", lastSync: syncedAt.toISOString() },
    ]);
  });
});
