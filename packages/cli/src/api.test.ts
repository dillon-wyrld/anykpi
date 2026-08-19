import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
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
});
