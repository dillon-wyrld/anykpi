import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiRequest,
  authHeaders,
  INGEST_EVENT_PATH,
  INGEST_IDENTIFY_PATH,
} from "./api";
import { createProgram } from "./program";

const originalEnv = {
  HOME: process.env.HOME,
  ANYKPI_API_KEY: process.env.ANYKPI_API_KEY,
  ANYKPI_API_URL: process.env.ANYKPI_API_URL,
  ANYKPI_CONFIG_DIR: process.env.ANYKPI_CONFIG_DIR,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function isolatedHome() {
  const dir = mkdtempSync(join(tmpdir(), "anykpi-cli-unit-"));
  process.env.HOME = dir;
  process.env.ANYKPI_CONFIG_DIR = join(dir, ".anykpi");
  return dir;
}

describe("CLI ingest client", () => {
  it("sends Authorization Bearer and x-api-key when a key is configured", () => {
    expect(authHeaders("secret-key")).toEqual({
      Authorization: "Bearer secret-key",
      "x-api-key": "secret-key",
    });
    expect(authHeaders(undefined)).toEqual({});
  });

  it("uses /api/ingest/* paths, not /api/v1/ingest/*", () => {
    expect(INGEST_EVENT_PATH).toBe("/api/ingest/event");
    expect(INGEST_IDENTIFY_PATH).toBe("/api/ingest/identify");
    expect(INGEST_EVENT_PATH).not.toMatch(/\/api\/v1\//);
    expect(INGEST_IDENTIFY_PATH).not.toMatch(/\/api\/v1\//);
  });

  it("apiRequest attaches both auth headers and the configured host", async () => {
    isolatedHome();
    process.env.ANYKPI_API_KEY = "test-key";
    process.env.ANYKPI_API_URL = "http://instance.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest(INGEST_EVENT_PATH, {
      method: "POST",
      body: JSON.stringify({ userId: "u1", eventName: "played" }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://instance.test/api/ingest/event");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("x-api-key")).toBe("test-key");
  });

  it("track and identify POST to the live ingest routes", async () => {
    isolatedHome();
    process.env.ANYKPI_API_KEY = "test-key";
    process.env.ANYKPI_API_URL = "http://instance.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(
      ["track", "u1", "song_played", "--workspace", "demo", "--json"],
      { from: "user" }
    );
    await program.parseAsync(
      ["identify", "u1", "--name", "Ada", "--workspace", "demo", "--json"],
      { from: "user" }
    );

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toContain("http://instance.test/api/ingest/event");
    expect(urls).toContain("http://instance.test/api/ingest/identify");
    expect(urls.some((url) => url.includes("/api/v1/ingest/"))).toBe(false);
  });

  it("sync POSTs /api/v1/sync with workspace and optional source", async () => {
    isolatedHome();
    process.env.ANYKPI_API_KEY = "test-key";
    process.env.ANYKPI_API_URL = "http://instance.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspace: "demo",
        results: [{ source: "posthog", rowsSynced: 0, health: "ok" }],
        states: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(
      ["sync", "--source", "posthog", "--workspace", "demo", "--json"],
      { from: "user" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://instance.test/api/v1/sync");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      workspace: "demo",
      source: "posthog",
    });
  });

  it("connect POSTs /api/v1/connect without echoing credentials in output", async () => {
    isolatedHome();
    process.env.ANYKPI_API_KEY = "test-key";
    process.env.ANYKPI_API_URL = "http://instance.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: "posthog",
        workspaceId: "live",
        connected: true,
        rotated: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.map(String).join(" "));
    });

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(
      [
        "connect",
        "posthog",
        "--workspace",
        "live",
        "--api-key",
        "phc_never_print_me",
        "--project-id",
        "proj_1",
        "--json",
      ],
      { from: "user" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://instance.test/api/v1/connect");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      source: "posthog",
      credentials: { apiKey: "phc_never_print_me", projectId: "proj_1" },
      workspaceId: "live",
    });
    expect(logs.join("\n")).not.toContain("phc_never_print_me");

    logSpy.mockRestore();
  });

  it("connect csv POSTs /api/v1/connect with kind and mapping", async () => {
    isolatedHome();
    process.env.ANYKPI_API_KEY = "test-key";
    process.env.ANYKPI_API_URL = "http://instance.test";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        source: "csv",
        workspaceId: "live",
        connected: true,
        rotated: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(
      [
        "connect",
        "csv",
        "--workspace",
        "live",
        "--kind",
        "events",
        "--map",
        "user_id=personId",
        "--map",
        "event=eventName",
        "--json",
      ],
      { from: "user" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://instance.test/api/v1/connect");
    expect(JSON.parse(String(init.body))).toEqual({
      source: "csv",
      credentials: {
        kind: "events",
        mapping: JSON.stringify({ user_id: "personId", event: "eventName" }),
      },
      workspaceId: "live",
    });
  });

  it("import POSTs /api/v1/import with the file and mapping", async () => {
    const dir = isolatedHome();
    process.env.ANYKPI_API_KEY = "test-key";
    process.env.ANYKPI_API_URL = "http://instance.test";

    const file = join(dir, "events.csv");
    writeFileSync(file, "user_id,ts,event\nu1,2026-01-01T00:00:00.000Z,played\n");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workspaceId: "live",
        kind: "events",
        imported: 1,
        skipped: 0,
        errors: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(
      [
        "import",
        file,
        "--kind",
        "events",
        "--map",
        "user_id=personId",
        "--map",
        "ts=timestamp",
        "--map",
        "event=eventName",
        "--workspace",
        "live",
        "--json",
      ],
      { from: "user" }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://instance.test/api/v1/import");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      csv: "user_id,ts,event\nu1,2026-01-01T00:00:00.000Z,played\n",
      workspaceId: "live",
      preview: false,
      kind: "events",
      mapping: {
        user_id: "personId",
        ts: "timestamp",
        event: "eventName",
      },
    });
  });

  it("keys lists metadata and keys downgrade POSTs /api/v1/keys/downgrade", async () => {
    isolatedHome();
    process.env.ANYKPI_API_KEY = "test-key";
    process.env.ANYKPI_API_URL = "http://instance.test";

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          keys: [
            {
              id: "ak_legacy",
              name: "old",
              scope: "write",
              legacy: true,
              lastUsedAt: null,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downgraded: ["ak_legacy"] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(["keys", "--json"], { from: "user" });
    await program.parseAsync(["keys", "downgrade", "--json"], { from: "user" });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://instance.test/api/v1/keys");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://instance.test/api/v1/keys/downgrade");
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).method).toBe("POST");
  });

  it("login mints with the requested scope and defaults to read", async () => {
    isolatedHome();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "ak_new",
        key: "ak_new.secret",
        scope: "read",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(
      [
        "login",
        "--url",
        "http://instance.test",
        "--key",
        "admin-key",
        "--name",
        "agent",
        "--workspace",
        "live",
      ],
      { from: "user" }
    );

    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      name: "agent",
      workspace: "live",
      scope: "read",
    });
  });
});
