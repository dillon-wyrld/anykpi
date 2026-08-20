import { afterEach, describe, expect, it, vi } from "vitest";
import Anykpi, { BATCH_PATH, EVENT_PATH, IDENTIFY_PATH, flush, identify, init, track } from "./index";
import { browserSnippet } from "./snippet";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });
  globalThis.fetch = fetchMock as typeof fetch;
  return fetchMock;
}

function flakyClient() {
  return new Anykpi({
    endpoint: "http://localhost:3000/",
    workspaceId: "live",
    apiKey: "test-key",
    flushIntervalMs: 15,
    retryDelayMs: 0,
    maxRetries: 8,
  });
}

describe("@anykpi/sdk", () => {
  it("identify POSTs to /api/ingest/identify and track flushes /api/ingest/batch", async () => {
    const fetchMock = mockFetch();
    const client = new Anykpi({
      endpoint: "http://localhost:3000/",
      workspaceId: "live",
      apiKey: "test-key",
    });

    await client.identify({
      userId: "u1",
      properties: { name: "Ada", platform: "web" },
    });
    await client.track("song_played", { genre: "jazz" });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const identifyCall = fetchMock.mock.calls[0];
    expect(identifyCall[0]).toBe(`http://localhost:3000${IDENTIFY_PATH}`);
    expect(identifyCall[1]).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
        "x-api-key": "test-key",
      },
    });
    expect(JSON.parse(identifyCall[1].body as string)).toMatchObject({
      userId: "u1",
      workspaceId: "live",
      properties: { name: "Ada", platform: "web" },
    });

    const trackCall = fetchMock.mock.calls[1];
    expect(trackCall[0]).toBe(`http://localhost:3000${BATCH_PATH}`);
    const batch = JSON.parse(trackCall[1].body as string) as {
      workspaceId: string;
      events: { userId: string; event: string; properties: { genre: string }; idempotencyKey: string }[];
    };
    expect(batch).toMatchObject({
      workspaceId: "live",
      events: [
        {
          userId: "u1",
          event: "song_played",
          properties: { genre: "jazz" },
        },
      ],
    });
    expect(batch.events[0]?.idempotencyKey).toMatch(/\S/);
    expect(EVENT_PATH).toBe("/api/ingest/event");
  });

  it("module-level track() uses the init() singleton and flush()", async () => {
    const fetchMock = mockFetch();
    init({ endpoint: "http://127.0.0.1:3000", apiKey: "k" });
    await identify({ userId: "mod-1" });
    await track("doc_created", { source: "sdk" });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const batch = JSON.parse(fetchMock.mock.calls[1][1].body as string) as {
      events: { event: string }[];
    };
    expect(batch.events[0]?.event).toBe("doc_created");
  });

  it("track() before identify() does not send", async () => {
    const fetchMock = mockFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = new Anykpi({ endpoint: "http://localhost:3000" });

    await client.track("too_soon");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[ANYKPI] track() called before identify()");
  });

  it("buffers multiple tracks into one batch and retries the same keys on a flaky network", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let failures = 2;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes(IDENTIFY_PATH)) {
        return Promise.resolve({ ok: true, status: 200 });
      }
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error("socket hang up"));
      }
      return Promise.resolve({ ok: true, status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = flakyClient();
    await client.identify({ userId: "u-flaky" });
    await Promise.all([
      client.track("played", { n: 1 }),
      client.track("shared", { n: 2 }),
      client.track("paid", { n: 3 }),
    ]);

    const batchCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes(BATCH_PATH));
    expect(batchCalls.length).toBe(3);

    const bodies = batchCalls.map(([, init]) =>
      JSON.parse((init as { body: string }).body) as {
        events: { event: string; idempotencyKey: string }[];
      }
    );
    const firstKeys = bodies[0]?.events.map((event) => event.idempotencyKey) ?? [];
    expect(firstKeys).toHaveLength(3);
    expect(new Set(firstKeys).size).toBe(3);
    for (const body of bodies) {
      expect(body.events.map((event) => event.idempotencyKey)).toEqual(firstKeys);
      expect(body.events.map((event) => event.event).sort()).toEqual(["paid", "played", "shared"]);
    }
    expect(error).toHaveBeenCalled();
  });

  it("browser snippet references the locally built /sdk.js artifact", () => {
    const html = browserSnippet({
      endpoint: "http://localhost:3000",
      workspaceId: "live",
      apiKey: "YOUR_API_KEY",
    });

    expect(html).toContain('src="http://localhost:3000/sdk.js"');
    expect(html).toContain("anykpi.init");
    expect(html).toContain("anykpi.identify");
    expect(html).toContain("anykpi.track");
  });
});
