/**
 * Once-a-minute DayTracker loop. Hidden tabs schedule nothing — no
 * clock recompute, no overview fetch, no paint.
 */

import { DAY_TRACKER_TICK_MS } from "@/components/day-tracker";

type IntervalId = ReturnType<typeof setInterval>;

export function createDayTrackerTicker(opts: {
  isHidden: () => boolean;
  onTick: () => void | Promise<void>;
  intervalMs?: number;
  setIntervalFn?: (handler: () => void, ms: number) => IntervalId;
  clearIntervalFn?: (id: IntervalId) => void;
}) {
  let timer: IntervalId | null = null;
  let stopped = false;
  let paints = 0;
  let fetches = 0;

  async function tick(): Promise<void> {
    if (stopped || opts.isHidden()) return;
    fetches += 1;
    await opts.onTick();
    paints += 1;
  }

  function start(): void {
    if (timer || stopped || opts.isHidden()) return;
    const interval = opts.setIntervalFn ?? setInterval;
    timer = interval(() => {
      void tick();
    }, opts.intervalMs ?? DAY_TRACKER_TICK_MS);
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
    void tick();
    start();
  }

  return {
    tick,
    start,
    stop,
    handleVisibility,
    counts: () => ({ paints, fetches, scheduled: timer != null }),
    async mount() {
      await tick();
      if (!stopped && !opts.isHidden()) start();
    },
    dispose() {
      stopped = true;
      stop();
    },
  };
}
