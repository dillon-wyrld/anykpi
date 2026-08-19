import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getSync, POST as postSync } from "@/app/api/v1/sync/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { registry } from "@/connectors";
import { caughtUpCursor } from "@/connectors/cursor";
import {
  fixtureDir,
  installConnectorFetch,
  loadFixtureSuite,
} from "@/connectors/testing";

const ADMIN = "sync-route-admin";
const originalKey = process.env.ANYKPI_API_KEY;
const originalPosthogKey = process.env.POSTHOG_API_KEY;
const originalPosthogProject = process.env.POSTHOG_PROJECT_ID;
const originalPosthogHost = process.env.POSTHOG_HOST;
const originalPosthogSync = registry.posthog.sync;

const TEST_WORKSPACES = [
  "sync-one",
  "sync-all",
  "sync-coalesce",
  "sync-unknown",
  "sync-error",
];

afterEach(async () => {
  registry.posthog.sync = originalPosthogSync;
  restoreEnv("ANYKPI_API_KEY", originalKey);
  restoreEnv("POSTHOG_API_KEY", originalPosthogKey);
  restoreEnv("POSTHOG_PROJECT_ID", originalPosthogProject);
  restoreEnv("POSTHOG_HOST", originalPosthogHost);
  vi.unstubAllEnvs();
  for (const workspace of TEST_WORKSPACES) {
    await db
      .delete(schema.syncState)
      .where(eq(schema.syncState.workspaceId, workspace));
    await db
      .delete(schema.activity)
      .where(eq(schema.activity.workspaceId, workspace));
    await db.delete(schema.users).where(eq(schema.users.workspaceId, workspace));
  }
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function get(url: string, headers?: Record<string, string>) {
  return new NextRequest(url, { headers });
}

function post(
  url: string,
  body?: unknown,
  headers?: Record<string, string>
) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function asAdmin(url: string, body?: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  vi.stubEnv("NODE_ENV", "test");
  return post(url, body ?? {}, { authorization: `Bearer ${ADMIN}` });
}

function installPosthogFixtures() {
  process.env.POSTHOG_API_KEY = "phx_test";
  process.env.POSTHOG_PROJECT_ID = "proj_fixture";
  process.env.POSTHOG_HOST = "https://app.posthog.com";
  const suite = loadFixtureSuite(fixtureDir("posthog"));
  return installConnectorFetch({
    fixtures: suite,
    recordDir: fixtureDir("posthog"),
    source: "posthog",
  });
}

describe("POST /api/v1/sync auth", () => {
  it("requires an API key even for the demo workspace (401)", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await postSync(
      post("http://localhost:3000/api/v1/sync", { workspace: "demo" })
    );
    expect(response.status).toBe(401);
  });

  it("GET demo remains readable without a key", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const response = await getSync(
      get("http://localhost:3000/api/v1/sync?workspace=demo")
    );
    expect(response.status).toBe(200);
  });
});

describe("POST /api/v1/sync", () => {
  it("syncs one source on fixtures and records pending → success", async () => {
    const harness = installPosthogFixtures();
    const statuses: string[] = [];
    const inner = registry.posthog.sync;
    registry.posthog.sync = async (workspaceId, opts) => {
      const mid = await db
        .select()
        .from(schema.syncState)
        .where(eq(schema.syncState.workspaceId, workspaceId))
        .get();
      if (mid) statuses.push(mid.status);
      return inner(workspaceId, opts);
    };

    try {
      const response = await postSync(
        asAdmin("http://localhost:3000/api/v1/sync", {
          source: "posthog",
          workspace: "sync-one",
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.workspace).toBe("sync-one");
      expect(body.results).toHaveLength(1);
      expect(body.results[0]).toMatchObject({
        source: "posthog",
        health: "ok",
        rowsSynced: 3,
        nextCursor: caughtUpCursor("2026-01-16T12:01:00.000Z"),
      });
      expect(body.states).toEqual([
        expect.objectContaining({
          source: "posthog",
          sourceName: "PostHog",
          status: "success",
        }),
      ]);
      expect(statuses).toEqual(["pending"]);

      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.personId, "person_fixture-ada"))
        .all();
      expect(users).toHaveLength(1);
      expect(users[0]?.workspaceId).toBe("sync-one");
    } finally {
      harness.restore();
    }
  });

  it("syncs all registered sources and records success or error per source", async () => {
    const harness = installPosthogFixtures();

    try {
      const response = await postSync(
        asAdmin("http://localhost:3000/api/v1/sync", {
          workspace: "sync-all",
        })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results.map((r: { source: string }) => r.source).sort()).toEqual(
        ["amplitude", "ics", "mercury", "mixpanel", "posthog", "revenuecat", "stripe"]
      );

      const bySource = Object.fromEntries(
        body.results.map((r: { source: string; health: string }) => [
          r.source,
          r.health,
        ])
      );
      expect(bySource.posthog).toBe("ok");
      expect(bySource.mixpanel).toBe("error");
      expect(bySource.amplitude).toBe("error");
      expect(bySource.stripe).toBe("error");
      expect(bySource.revenuecat).toBe("error");
      expect(bySource.mercury).toBe("error");
      expect(bySource.ics).toBe("error");

      const states = Object.fromEntries(
        body.states.map((s: { source: string; status: string }) => [
          s.source,
          s.status,
        ])
      );
      expect(states.posthog).toBe("success");
      expect(states.mixpanel).toBe("error");
      expect(states.amplitude).toBe("error");
      expect(states.stripe).toBe("error");
      expect(states.revenuecat).toBe("error");
      expect(states.mercury).toBe("error");
      expect(states.ics).toBe("error");
    } finally {
      harness.restore();
    }
  });

  it("two concurrent POSTs for the same source produce exactly one run", async () => {
    let runs = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    registry.posthog.sync = async () => {
      runs += 1;
      await held;
      return { rowsSynced: 1, nextCursor: null, health: "ok" };
    };

    const first = postSync(
      asAdmin("http://localhost:3000/api/v1/sync", {
        source: "posthog",
        workspace: "sync-coalesce",
      })
    );
    await vi.waitFor(() => {
      expect(runs).toBe(1);
    });

    const second = postSync(
      asAdmin("http://localhost:3000/api/v1/sync", {
        source: "posthog",
        workspace: "sync-coalesce",
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(runs).toBe(1);
    release();

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(runs).toBe(1);

    const bodyA = await a.json();
    const bodyB = await b.json();
    expect(bodyA.results[0].rowsSynced).toBe(1);
    expect(bodyB.results[0].rowsSynced).toBe(1);
  });

  it("rejects an unknown source with 400", async () => {
    const response = await postSync(
      asAdmin("http://localhost:3000/api/v1/sync", {
        source: "not-a-source",
        workspace: "sync-unknown",
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/Unknown connector source/);
  });

  it("records pending → error when a connector throws before writing state", async () => {
    delete process.env.POSTHOG_API_KEY;
    const statuses: string[] = [];
    const inner = registry.posthog.sync;
    registry.posthog.sync = async (workspaceId, opts) => {
      const mid = await db
        .select()
        .from(schema.syncState)
        .where(eq(schema.syncState.workspaceId, workspaceId))
        .get();
      if (mid) statuses.push(mid.status);
      return inner(workspaceId, opts);
    };

    const response = await postSync(
      asAdmin("http://localhost:3000/api/v1/sync", {
        source: "posthog",
        workspace: "sync-error",
      })
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results[0].health).toBe("error");
    expect(body.states[0].status).toBe("error");
    expect(statuses).toEqual(["pending"]);
  });
});
