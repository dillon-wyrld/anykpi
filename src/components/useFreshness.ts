"use client";

import { useEffect, useRef } from "react";
import { FreshnessResponseSchema } from "@/core/contracts";
import {
  createFreshnessPoller,
  type FreshnessWatch,
} from "@/components/freshness-poll";

export { FRESHNESS_POLL_MS } from "@/components/freshness-poll";
export type { FreshnessWatch } from "@/components/freshness-poll";

/**
 * Poll /api/v1/freshness about every 30s. Paused while the tab is hidden.
 * Calls onStale only after a watched stamp moves — no spinner, no layout swap.
 */
export function useFreshness(options: {
  workspace: string;
  watch: readonly FreshnessWatch[];
  onStale: () => void;
}): void {
  const onStaleRef = useRef(options.onStale);
  onStaleRef.current = options.onStale;
  const watchKey = options.watch.join(",");

  useEffect(() => {
    const watch = watchKey.split(",").filter(Boolean) as FreshnessWatch[];
    const poller = createFreshnessPoller({
      load: async () => {
        const response = await fetch(
          `/api/v1/freshness?workspace=${encodeURIComponent(options.workspace)}`
        );
        if (!response.ok) {
          throw new Error("freshness");
        }
        return FreshnessResponseSchema.parse(await response.json());
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
}
