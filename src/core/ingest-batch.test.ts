import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postBatch } from "@/app/api/ingest/batch/route";
import { POST as postIdentify } from "@/app/api/ingest/identify/route";
import { db } from "./db";
import * as schema from "./schema";
import {
  BATCH_INGEST_MAX_EVENTS,
  countWorkspaceActivity,
  ingestEventExternalId,
  runIngestBatch,
} from "./ingest-batch";
import Anykpi, { BATCH_PATH, IDENTIFY_PATH } from "../../packages/sdk/src/index";

const ADMIN = "batch-ingest-admin";
const WS = "batch-ingest";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

function asAdmin(body: unknown, url = "http://localhost:3000/api/ingest/batch") {
  process.env.ANYKPI_API_KEY = ADMIN;
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
      "x-api-key": ADMIN,
    },
    body: JSON.stringify(body),
  });
}

function sampleEvents(count: number, prefix = "replay") {
  return Array.from({ length: count }, (_, i) => ({
    userId: `${prefix}-user-${i % 3}`,
    event: i % 5 === 0 ? "search_query" : "song_played",
    timestamp: "2026-03-01T00:00:00.000Z",
    properties: { platform: "web", name: "Batch User" },
    idempotencyKey: `${prefix}-key-${i}`,
  }));
}

describe("ingestEventExternalId", () => {
  it("prefers idempotencyKey then externalId, else a stable hash", () => {
    const base = {
      personId: "person_u1",
      timestamp: new Date("2026-03-01T00:00:00.000Z"),
      eventName: "song_played",
      platform: "web",
    };
    expect(ingestEventExternalId({ ...base, idempotencyKey: "ik_1" })).toBe("ik_1");
    expect(ingestEventExternalId({ ...base, externalId: "ext_1" })).toBe("ext_1");
    const derived = ingestEventExternalId(base);
    expect(derived).toHaveLength(64);
    expect(ingestEventExternalId(base)).toBe(derived);
  });
});

describe("POST /api/ingest/batch", () => {
  it("rejects unauthenticated writes with 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const res = await postBatch(
      new NextRequest("http://localhost:3000/api/ingest/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: WS, events: sampleEvents(1) }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("replaying the same batch twice changes nothing", async () => {
    const events = sampleEvents(5);
    const first = await postBatch(asAdmin({ workspaceId: WS, events }));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toEqual({
      success: true,
      accepted: 5,
      inserted: 5,
      duplicates: 0,
    });
    expect(countWorkspaceActivity(WS)).toBe(5);

    const second = await postBatch(asAdmin({ workspaceId: WS, events }));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      success: true,
      accepted: 5,
      inserted: 0,
      duplicates: 5,
    });
    expect(countWorkspaceActivity(WS)).toBe(5);
  });

  it("commits a 1k-event batch as one transaction", async () => {
    const spy = vi.spyOn(db, "transaction");
    const events = sampleEvents(BATCH_INGEST_MAX_EVENTS, "one-k");
    const res = await postBatch(asAdmin({ workspaceId: WS, events }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(1000);
    expect(body.inserted).toBe(1000);
    expect(body.duplicates).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(countWorkspaceActivity(WS)).toBe(1000);
  });

  it("rolls back every row when the transaction throws", async () => {
    const original = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementation(((
      fn: Parameters<typeof db.transaction>[0]
    ) => {
      return original((tx) => {
        fn(tx);
        throw new Error("forced rollback");
      });
    }) as typeof db.transaction);

    const res = await postBatch(
      asAdmin({ workspaceId: WS, events: sampleEvents(25, "rollback") })
    );
    expect(res.status).toBe(500);
    expect(countWorkspaceActivity(WS)).toBe(0);
  });

  it("rejects more than 1k events and an oversized body", async () => {
    const tooMany = await postBatch(
      asAdmin({ workspaceId: WS, events: sampleEvents(1001, "too-many") })
    );
    expect(tooMany.status).toBe(400);
    expect(countWorkspaceActivity(WS)).toBe(0);

    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    const huge = {
      workspaceId: WS,
      events: [
        {
          userId: "u",
          event: "e",
          idempotencyKey: "huge",
          properties: { blob: "A".repeat(1024 * 1024) },
        },
      ],
    };
    const oversized = await postBatch(
      new NextRequest("http://localhost:3000/api/ingest/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify(huge),
      })
    );
    expect(oversized.status).toBe(413);
  });
});

describe("SDK batch flush under a flaky network", () => {
  it("delivers every event exactly once when fetch fails then succeeds", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    let batchAttempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const request = new NextRequest(url, {
        method: init?.method ?? "POST",
        headers: init?.headers,
        body: init?.body ?? undefined,
      });
      if (url.includes(IDENTIFY_PATH)) {
        const res = await postIdentify(request);
        return new Response(await res.text(), { status: res.status });
      }
      if (url.includes(BATCH_PATH)) {
        batchAttempts += 1;
        if (batchAttempts < 3) {
          throw new Error("socket hang up");
        }
        const res = await postBatch(request);
        return new Response(await res.text(), { status: res.status });
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    try {
      const client = new Anykpi({
        endpoint: "http://localhost:3000",
        workspaceId: WS,
        apiKey: ADMIN,
        flushIntervalMs: 15,
        retryDelayMs: 0,
        maxRetries: 6,
      });
      await client.identify({
        userId: "sdk-flaky",
        properties: { name: "SDK flaky", platform: "web" },
      });
      await Promise.all([
        client.track("played", { n: 1 }),
        client.track("shared", { n: 2 }),
        client.track("paid", { n: 3 }),
      ]);

      expect(batchAttempts).toBe(3);
      expect(countWorkspaceActivity(WS)).toBe(3);

      await client.flush();
      expect(countWorkspaceActivity(WS)).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runIngestBatch", () => {
  it("no-ops intra-batch duplicate keys", () => {
    const result = runIngestBatch(WS, [
      {
        userId: "dup",
        eventName: "song_played",
        idempotencyKey: "same",
        timestamp: "2026-03-01T00:00:00.000Z",
      },
      {
        userId: "dup",
        eventName: "song_played",
        idempotencyKey: "same",
        timestamp: "2026-03-01T00:00:00.000Z",
      },
    ]);
    expect(result).toEqual({ accepted: 2, inserted: 1, duplicates: 1 });
    expect(countWorkspaceActivity(WS)).toBe(1);
  });
});
