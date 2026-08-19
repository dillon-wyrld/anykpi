import { afterEach, describe, expect, it } from "vitest";
import {
  authorize,
  extractApiKey,
  hashedKeyMatches,
  resolveWorkspace,
  sha256Hex,
} from "./auth";

function requestWith(headers: Record<string, string> = {}): {
  headers: { get(name: string): string | null };
} {
  const normalized = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    headers: {
      get(name: string) {
        return normalized.get(name.toLowerCase()) ?? null;
      },
    },
  };
}

function statusOf(result: Awaited<ReturnType<typeof authorize>>): number {
  if (result.ok) return 200;
  return result.status;
}

describe("extractApiKey", () => {
  it("reads Authorization: Bearer", () => {
    expect(
      extractApiKey(requestWith({ Authorization: "Bearer secret-key" }))
    ).toBe("secret-key");
  });

  it("reads x-api-key", () => {
    expect(extractApiKey(requestWith({ "x-api-key": "header-key" }))).toBe(
      "header-key"
    );
  });

  it("returns null when missing", () => {
    expect(extractApiKey(requestWith())).toBeNull();
  });
});

describe("authorize", () => {
  const originalKey = process.env.ANYKPI_API_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ANYKPI_API_KEY;
    } else {
      process.env.ANYKPI_API_KEY = originalKey;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("demo GET allowed without a key", async () => {
    delete process.env.ANYKPI_API_KEY;
    process.env.NODE_ENV = "test";

    const result = await authorize(requestWith(), {
      workspace: "demo",
      write: false,
    });

    expect(result.ok).toBe(true);
    expect(statusOf(result)).toBe(200);
  });

  it("live GET without key → 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    process.env.NODE_ENV = "test";

    const result = await authorize(requestWith(), {
      workspace: "live",
      write: false,
    });

    expect(result.ok).toBe(false);
    expect(statusOf(result)).toBe(401);
  });

  it("ingest without key → 401", async () => {
    delete process.env.ANYKPI_API_KEY;
    process.env.NODE_ENV = "test";

    const result = await authorize(requestWith(), { write: true });

    expect(result.ok).toBe(false);
    expect(statusOf(result)).toBe(401);
  });

  it("valid key → 200", async () => {
    process.env.ANYKPI_API_KEY = "test-admin-key";
    process.env.NODE_ENV = "test";

    const bearer = await authorize(
      requestWith({ Authorization: "Bearer test-admin-key" }),
      { workspace: "live", write: false }
    );
    expect(bearer.ok).toBe(true);
    expect(statusOf(bearer)).toBe(200);

    const headerKey = await authorize(
      requestWith({ "x-api-key": "test-admin-key" }),
      { write: true }
    );
    expect(headerKey.ok).toBe(true);
    expect(statusOf(headerKey)).toBe(200);
  });

  it("wrong key → 401", async () => {
    process.env.ANYKPI_API_KEY = "test-admin-key";
    process.env.NODE_ENV = "test";

    const result = await authorize(
      requestWith({ Authorization: "Bearer no-match" }),
      { workspace: "live" }
    );

    expect(statusOf(result)).toBe(401);
  });

  it("hashed key matches via SHA-256 timing-safe compare", () => {
    const raw = "ak_test.secret";
    const digest = sha256Hex(raw);
    expect(hashedKeyMatches(raw, digest)).toBe(true);
    expect(hashedKeyMatches("wrong", digest)).toBe(false);
  });

  it("hashed key workspace wins on writes; env admin may choose", () => {
    const hashed = resolveWorkspace(
      {
        ok: true,
        actor: "hashed",
        keyWorkspace: "live",
        canChooseWorkspace: false,
      },
      "demo",
      true
    );
    expect("workspace" in hashed && hashed.workspace).toBe("live");

    const env = resolveWorkspace(
      { ok: true, actor: "env", canChooseWorkspace: true },
      "team-a",
      true
    );
    expect("workspace" in env && env.workspace).toBe("team-a");
  });

  it("production without ANYKPI_API_KEY refuses live reads and writes with 503", async () => {
    delete process.env.ANYKPI_API_KEY;
    process.env.NODE_ENV = "production";

    const live = await authorize(requestWith(), { workspace: "live" });
    expect(statusOf(live)).toBe(503);
    if (!live.ok) {
      expect(live.error).toMatch(/ANYKPI_API_KEY/);
    }

    const ingest = await authorize(requestWith(), { write: true });
    expect(statusOf(ingest)).toBe(503);

    const demo = await authorize(requestWith(), { workspace: "demo" });
    expect(demo.ok).toBe(true);
  });
});
