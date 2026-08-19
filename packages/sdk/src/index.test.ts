import { afterEach, describe, expect, it, vi } from "vitest";
import Anykpi, { EVENT_PATH, IDENTIFY_PATH, identify, init, track } from "./index";
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

describe("@anykpi/sdk", () => {
  it("identify and track POST to /api/ingest/* with the API key", async () => {
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
    expect(trackCall[0]).toBe(`http://localhost:3000${EVENT_PATH}`);
    expect(JSON.parse(trackCall[1].body as string)).toMatchObject({
      userId: "u1",
      event: "song_played",
      workspaceId: "live",
      properties: { genre: "jazz" },
    });
  });

  it("module-level track() uses the init() singleton", async () => {
    const fetchMock = mockFetch();
    init({ endpoint: "http://127.0.0.1:3000", apiKey: "k" });
    await identify({ userId: "mod-1" });
    await track("doc_created", { source: "sdk" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).event).toBe("doc_created");
  });

  it("track() before identify() does not send", async () => {
    const fetchMock = mockFetch();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = new Anykpi({ endpoint: "http://localhost:3000" });

    await client.track("too_soon");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[ANYKPI] track() called before identify()");
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
