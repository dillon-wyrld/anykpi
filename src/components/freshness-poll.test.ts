import { describe, expect, it, vi } from "vitest";
import {
  createFreshnessPoller,
  freshnessStamp,
} from "@/components/freshness-poll";

describe("freshnessStamp", () => {
  it("changes only for the watched section", () => {
    const first = {
      lastIngest: "1:2026-08-19T10:00:00.000Z",
      sources: [{ source: "posthog", lastSync: "2026-08-19T09:00:00.000Z" }],
    };
    const ingestMoved = {
      lastIngest: "2:2026-08-19T10:01:00.000Z",
      sources: first.sources,
    };
    const syncMoved = {
      lastIngest: first.lastIngest,
      sources: [{ source: "posthog", lastSync: "2026-08-19T09:30:00.000Z" }],
    };

    expect(freshnessStamp(first, ["ingest"])).not.toBe(
      freshnessStamp(ingestMoved, ["ingest"])
    );
    expect(freshnessStamp(first, ["sources"])).toBe(
      freshnessStamp(ingestMoved, ["sources"])
    );
    expect(freshnessStamp(first, ["sources"])).not.toBe(
      freshnessStamp(syncMoved, ["sources"])
    );
  });
});

describe("createFreshnessPoller", () => {
  it("does not poll when the tab is hidden", async () => {
    let loads = 0;
    const stale = vi.fn();
    const poller = createFreshnessPoller({
      load: async () => {
        loads += 1;
        return { lastIngest: "1:t", sources: [] };
      },
      isHidden: () => true,
      watch: ["ingest"],
      onStale: stale,
    });

    await poller.mount();
    await poller.tick(true);
    poller.start();
    poller.dispose();

    expect(loads).toBe(0);
    expect(stale).not.toHaveBeenCalled();
  });

  it("refetches only after a watched stamp moves", async () => {
    let lastIngest = "1:t";
    const stale = vi.fn();
    const poller = createFreshnessPoller({
      load: async () => ({ lastIngest, sources: [] }),
      isHidden: () => false,
      watch: ["ingest"],
      onStale: stale,
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });

    await poller.mount();
    expect(stale).not.toHaveBeenCalled();

    await poller.tick(true);
    expect(stale).not.toHaveBeenCalled();

    lastIngest = "2:t";
    await poller.tick(true);
    expect(stale).toHaveBeenCalledTimes(1);
    poller.dispose();
  });
});
