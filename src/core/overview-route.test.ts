import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getOverview } from "@/app/api/v1/overview/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertSyncState } from "@/core/upsert";

const ADMIN = "overview-route-admin";
const WS = "overview-health";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
});

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

describe("GET /api/v1/overview syncHealth", () => {
  it("demo remains readable and includes syncHealth", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getOverview(
      get("http://localhost:3000/api/v1/overview?workspace=demo")
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspace).toBe("demo");
    expect(Array.isArray(body.syncHealth)).toBe(true);
    expect(body.presence).toEqual(
      expect.objectContaining({
        online: expect.any(Number),
        cities: expect.any(Array),
      })
    );
  });

  it("shows a failing source as error", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    await upsertSyncState({
      source: "mixpanel",
      sourceName: "Mixpanel",
      lastSync: new Date("2026-08-20T06:00:00.000Z"),
      status: "error",
      error: "sync failed",
      workspaceId: WS,
    });

    const response = await getOverview(
      get(`http://localhost:3000/api/v1/overview?workspace=${WS}`, {
        authorization: `Bearer ${ADMIN}`,
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.syncHealth).toEqual([
      expect.objectContaining({
        source: "mixpanel",
        sourceName: "Mixpanel",
        status: "error",
        error: "sync failed",
        lastSynced: "2026-08-20T06:00:00.000Z",
      }),
    ]);
  });
});
