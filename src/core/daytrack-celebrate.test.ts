import { describe, expect, it } from "vitest";
import {
  markCelebrated,
  shouldFireCelebration,
} from "@/core/daytrack-celebrate";

const KEY = "live:company_day:365";

describe("shouldFireCelebration", () => {
  it("fires exactly once per milestone", () => {
    const first = shouldFireCelebration({
      milestoneKey: KEY,
      celebratedKeys: [],
      reducedMotion: false,
    });
    expect(first).toBe(true);

    const after = markCelebrated([], KEY);
    expect(after).toEqual([KEY]);
    expect(
      shouldFireCelebration({
        milestoneKey: KEY,
        celebratedKeys: after,
        reducedMotion: false,
      })
    ).toBe(false);
    expect(markCelebrated(after, KEY)).toEqual([KEY]);
  });

  it("does nothing under prefers-reduced-motion", () => {
    expect(
      shouldFireCelebration({
        milestoneKey: KEY,
        celebratedKeys: [],
        reducedMotion: true,
      })
    ).toBe(false);
    expect(
      shouldFireCelebration({
        milestoneKey: null,
        celebratedKeys: [],
        reducedMotion: false,
      })
    ).toBe(false);
  });
});
