import type { FreshnessResponse } from "@/core/contracts";

export const FRESHNESS_POLL_MS = 30_000;

export type FreshnessWatch = "ingest" | "sources";

export function freshnessStamp(
  data: Pick<FreshnessResponse, "lastIngest" | "sources">,
  watch: readonly FreshnessWatch[]
): string {
  const parts: string[] = [];
  if (watch.includes("ingest")) {
    parts.push(`ingest:${data.lastIngest ?? ""}`);
  }
  if (watch.includes("sources")) {
    const sources = [...data.sources]
      .sort((a, b) => a.source.localeCompare(b.source))
      .map((row) => `${row.source}:${row.lastSync ?? ""}`)
      .join(",");
    parts.push(`sources:${sources}`);
  }
  return parts.join("|");
}

export function createFreshnessPoller(opts: {
  load: () => Promise<Pick<FreshnessResponse, "lastIngest" | "sources">>;
  isHidden: () => boolean;
  watch: readonly FreshnessWatch[];
  onStale: () => void;
  intervalMs?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}) {
  let known: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function tick(triggerStale: boolean): Promise<void> {
    if (stopped || opts.isHidden()) return;
    let data: Pick<FreshnessResponse, "lastIngest" | "sources">;
    try {
      data = await opts.load();
    } catch {
      return;
    }
    if (stopped) return;
    const next = freshnessStamp(data, opts.watch);
    if (triggerStale && known !== null && next !== known) {
      opts.onStale();
    }
    known = next;
  }

  function start(): void {
    if (timer || stopped || opts.isHidden()) return;
    const interval = opts.setIntervalFn ?? setInterval;
    timer = interval(() => {
      void tick(true);
    }, opts.intervalMs ?? FRESHNESS_POLL_MS);
  }

  function stop(): void {
    if (!timer) return;
    const clear = opts.clearIntervalFn ?? clearInterval;
    clear(timer);
    timer = null;
  }

  function handleVisibility(): void {
    if (opts.isHidden()) {
      stop();
      return;
    }
    void tick(true);
    start();
  }

  return {
    tick,
    start,
    stop,
    handleVisibility,
    async mount() {
      await tick(false);
      if (!stopped && !opts.isHidden()) start();
    },
    dispose() {
      stopped = true;
      stop();
    },
  };
}
