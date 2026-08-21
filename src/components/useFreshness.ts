"use client";

import { useEffect, useRef, useState } from "react";
import { FreshnessResponseSchema, SyncResponseSchema } from "@/core/contracts";
import {
  createFreshnessPoller,
  type FreshnessWatch,
} from "@/components/freshness-poll";
import {
  FRESHNESS_CHIP_UNKNOWN,
  freshnessChipFromStates,
  type FreshnessChipState,
} from "@/components/freshness-chip";

export { FRESHNESS_POLL_MS } from "@/components/freshness-poll";
export type { FreshnessWatch } from "@/components/freshness-poll";
export type { FreshnessChipState } from "@/components/freshness-chip";

/**
 * Poll /api/v1/freshness about every 30s. Paused while the tab is hidden.
 * Calls onStale only after a watched stamp moves — no spinner, no layout swap.
 * Also reads GET /api/v1/sync so the freshness chip can show a failing source
 * and link to /connect#health.
 */
export function useFreshness(options: {
  workspace: string;
  watch: readonly FreshnessWatch[];
  onStale: () => void;
  onHealth?: (health: FreshnessChipState) => void;
}): FreshnessChipState {
  const [health, setHealth] = useState<FreshnessChipState>(FRESHNESS_CHIP_UNKNOWN);
  const onStaleRef = useRef(options.onStale);
  onStaleRef.current = options.onStale;
  const onHealthRef = useRef(options.onHealth);
  onHealthRef.current = options.onHealth;
  const watchKey = options.watch.join(",");

  useEffect(() => {
    const watch = watchKey.split(",").filter(Boolean) as FreshnessWatch[];
    const applyHealth = (next: FreshnessChipState) => {
      setHealth(next);
      onHealthRef.current?.(next);
    };
    const poller = createFreshnessPoller({
      load: async () => {
        const query = `workspace=${encodeURIComponent(options.workspace)}`;
        const [freshnessRes, syncRes] = await Promise.all([
          fetch(`/api/v1/freshness?${query}`, { credentials: "include" }),
          fetch(`/api/v1/sync?${query}`, { credentials: "include" }),
        ]);
        if (!freshnessRes.ok) {
          throw new Error("freshness");
        }
        if (syncRes.ok) {
          const sync = SyncResponseSchema.parse(await syncRes.json());
          applyHealth(freshnessChipFromStates(sync.states));
        }
        return FreshnessResponseSchema.parse(await freshnessRes.json());
      },
      isHidden: () => document.visibilityState === "hidden",
      watch,
      onStale: () => onStaleRef.current(),
    });

    const onVisibility = () => poller.handleVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    void poller.mount();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      poller.dispose();
    };
  }, [options.workspace, watchKey]);

  return health;
}
