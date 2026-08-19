import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENT_PATH, IDENTIFY_PATH } from "./index";
import { installAnykpiBrowser } from "./browser-install";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("installAnykpiBrowser", () => {
  it("replays queued init/identify/track from the copy-paste snippet", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchMock as typeof fetch;

    const queue: unknown[] = [];
    const enqueue = (method: string) => {
      return function queued(this: unknown, ...args: unknown[]) {
        queue.push([method, ...args]);
      };
    };
    (queue as { init?: unknown }).init = enqueue("init");
    (queue as { identify?: unknown }).identify = enqueue("identify");
    (queue as { track?: unknown }).track = enqueue("track");
    (queue as { init: (config: unknown) => void }).init({
      endpoint: "http://localhost:3000",
      workspaceId: "live",
      apiKey: "snippet-key",
    });
    (queue as { identify: (user: unknown) => void }).identify({
      userId: "snippet-user",
      properties: { platform: "WEB" },
    });
    (queue as { track: (name: string, props?: unknown) => void }).track("song_played", {
      genre: "jazz",
    });

    const scope: { anykpi?: unknown } = { anykpi: queue };
    const api = installAnykpiBrowser(scope);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(fetchMock.mock.calls[0][0]).toBe(`http://localhost:3000${IDENTIFY_PATH}`);
    expect(fetchMock.mock.calls[1][0]).toBe(`http://localhost:3000${EVENT_PATH}`);
    expect(scope.anykpi).toBe(api);
    expect(typeof api.track).toBe("function");
  });
});
