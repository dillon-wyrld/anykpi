import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as postConnect } from "@/app/api/v1/connect/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import { loadSourceCiphertext, loadSourceConfig } from "@/core/sources";
import { sync } from "@/connectors";
import { fixtureDir, installConnectorFetch, loadFixtureSuite } from "@/connectors/testing";

const ADMIN = "connect-route-admin";
const SECRET = "phc_connect_plaintext_must_not_persist";
const WS = "connect-route";

const originalKey = process.env.ANYKPI_API_KEY;
const originalSecret = process.env.ANYKPI_SECRET;
const originalPosthogKey = process.env.POSTHOG_API_KEY;
const originalPosthogProject = process.env.POSTHOG_PROJECT_ID;
const originalPosthogHost = process.env.POSTHOG_HOST;

afterEach(async () => {
  restoreEnv("ANYKPI_API_KEY", originalKey);
  restoreEnv("ANYKPI_SECRET", originalSecret);
  restoreEnv("POSTHOG_API_KEY", originalPosthogKey);
  restoreEnv("POSTHOG_PROJECT_ID", originalPosthogProject);
  restoreEnv("POSTHOG_HOST", originalPosthogHost);
  vi.unstubAllEnvs();
  await db.delete(schema.sources).where(eq(schema.sources.workspaceId, WS));
  await db.delete(schema.syncState).where(eq(schema.syncState.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function asAdmin(body: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  process.env.ANYKPI_SECRET = originalSecret ?? "vitest-anykpi-secret";
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest("http://localhost:3000/api/v1/connect", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: JSON.stringify(body),
  });
}

function captureLogs() {
  const lines: string[] = [];
  const push = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const log = vi.spyOn(console, "log").mockImplementation(push);
  const error = vi.spyOn(console, "error").mockImplementation(push);
  const warn = vi.spyOn(console, "warn").mockImplementation(push);
  const info = vi.spyOn(console, "info").mockImplementation(push);
  return {
    lines,
    restore() {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
      info.mockRestore();
    },
  };
}

describe("POST /api/v1/connect", () => {
  it("persists PostHog config as ciphertext and never returns or logs the secret", async () => {
    const logs = captureLogs();
    const res = await postConnect(
      asAdmin({
        source: "posthog",
        workspaceId: WS,
        credentials: {
          apiKey: SECRET,
          projectId: "proj_connect",
          host: "https://app.posthog.com",
        },
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(SECRET);
    expect(body).toEqual({
      source: "posthog",
      workspaceId: WS,
      connected: true,
      rotated: false,
    });

    const ciphertext = await loadSourceCiphertext(WS, "posthog");
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(SECRET);
    expect(ciphertext).not.toContain("apiKey");
    expect(ciphertext).not.toContain("proj_connect");

    const decrypted = await loadSourceConfig(WS, "posthog");
    expect(decrypted).toEqual({
      apiKey: SECRET,
      projectId: "proj_connect",
      host: "https://app.posthog.com",
    });

    expect(logs.lines.join("\n")).not.toContain(SECRET);
    logs.restore();
  });

  it("rotates on re-submit and sync uses the new credential", async () => {
    const first = "phc_first_rotate_value";
    const second = "phc_second_rotate_value";
    const logs = captureLogs();

    const created = await postConnect(
      asAdmin({
        source: "posthog",
        workspaceId: WS,
        credentials: {
          apiKey: first,
          projectId: "proj_fixture",
          host: "https://app.posthog.com",
        },
      })
    );
    expect(created.status).toBe(201);

    delete process.env.POSTHOG_API_KEY;
    delete process.env.POSTHOG_PROJECT_ID;
    delete process.env.POSTHOG_HOST;

    const seen: string[] = [];
    const suite = loadFixtureSuite(fixtureDir("posthog"));
    const harness = installConnectorFetch({
      fixtures: suite,
      recordDir: fixtureDir("posthog"),
      source: "posthog",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const auth = headers.get("Authorization") ?? "";
      seen.push(auth);
      return originalFetch(input, init);
    }) as typeof fetch;

    try {
      await sync("posthog", WS);
      expect(seen.some((auth) => auth.includes(first))).toBe(true);
      expect(seen.some((auth) => auth.includes(second))).toBe(false);

      seen.length = 0;
      const rotated = await postConnect(
        asAdmin({
          source: "posthog",
          workspaceId: WS,
          credentials: {
            apiKey: second,
            projectId: "proj_fixture",
            host: "https://app.posthog.com",
          },
        })
      );
      expect(rotated.status).toBe(200);
      const rotatedBody = await rotated.json();
      expect(rotatedBody.rotated).toBe(true);
      expect(JSON.stringify(rotatedBody)).not.toContain(first);
      expect(JSON.stringify(rotatedBody)).not.toContain(second);

      await sync("posthog", WS);
      expect(seen.some((auth) => auth.includes(second))).toBe(true);
      expect(seen.some((auth) => auth.includes(first))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      harness.restore();
    }

    const ciphertext = await loadSourceCiphertext(WS, "posthog");
    expect(ciphertext).not.toContain(first);
    expect(ciphertext).not.toContain(second);
    expect(logs.lines.join("\n")).not.toContain(first);
    expect(logs.lines.join("\n")).not.toContain(second);
    logs.restore();
  });

  it("persists CSV mapping as ciphertext and never returns it", async () => {
    const mapping = JSON.stringify({ user_id: "personId", event: "eventName" });
    const res = await postConnect(
      asAdmin({
        source: "csv",
        workspaceId: WS,
        credentials: { kind: "events", mapping },
      })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(mapping);
    expect(body).toEqual({
      source: "csv",
      workspaceId: WS,
      connected: true,
      rotated: false,
    });

    const ciphertext = await loadSourceCiphertext(WS, "csv");
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain("personId");
    expect(ciphertext).not.toContain(mapping);

    const decrypted = await loadSourceConfig(WS, "csv");
    expect(decrypted).toEqual({ kind: "events", mapping });
  });

  it("rejects unauthenticated writes with 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    vi.stubEnv("NODE_ENV", "test");

    const res = await postConnect(
      new NextRequest("http://localhost:3000/api/v1/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "posthog",
          workspaceId: "demo",
          credentials: { apiKey: "x", projectId: "y" },
        }),
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 503 when ANYKPI_SECRET is unset", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    delete process.env.ANYKPI_SECRET;
    vi.stubEnv("NODE_ENV", "test");

    const res = await postConnect(
      new NextRequest("http://localhost:3000/api/v1/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          source: "posthog",
          workspaceId: WS,
          credentials: { apiKey: "x", projectId: "y" },
        }),
      })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ANYKPI_SECRET/);
  });
});
