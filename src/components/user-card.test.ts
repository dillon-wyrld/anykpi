import { describe, expect, it } from "vitest";
import {
  clampCardPosition,
  clusterNote,
  stripDays,
  STRIP_WINDOW,
  USER_CARD_BOTTOM_EDGE,
  USER_CARD_RIGHT_EDGE,
} from "@/components/user-card";

const SEEDED_CLUSTERS: Array<[string, string, string]> = [
  ["daily", "🔥 Power daily", "power user — basically lives here"],
  ["weekday", "💼 Weekday workers", "strictly business hours"],
  ["weekender", "🌴 Weekenders", "weekend warrior"],
  ["casual", "🌙 Occasional", "drops by when the mood hits"],
  ["monthly", "🗓️ Monthly check-ins", "monthly check-in energy"],
  ["burst", "⚡ Bursty", "binges, then vanishes, then binges"],
  ["churned", "🫥 Fading away", "gone quiet — send a nudge?"],
  ["newbie", "🐣 Brand new", "brand new — be nice"],
];

describe("clusterNote", () => {
  it("maps all eight seeded cluster ids and swimlane labels", () => {
    expect(SEEDED_CLUSTERS).toHaveLength(8);
    for (const [id, label, note] of SEEDED_CLUSTERS) {
      expect(clusterNote(id)).toBe(note);
      expect(clusterNote(label)).toBe(note);
    }
  });

  it("renders nothing for a missing or unknown cluster", () => {
    expect(clusterNote(null)).toBeNull();
    expect(clusterNote(undefined)).toBeNull();
    expect(clusterNote("")).toBeNull();
    expect(clusterNote("   ")).toBeNull();
    expect(clusterNote("unknown")).toBeNull();
  });
});

describe("stripDays", () => {
  it("windows the trailing 56 days of a longer row", () => {
    const activity = Array.from({ length: 80 }, (_, i) => i >= 70);
    const strip = stripDays(activity);

    expect(strip).toHaveLength(STRIP_WINDOW);
    expect(strip.slice(0, 46).every((d) => !d)).toBe(true);
    expect(strip.slice(46).every(Boolean)).toBe(true);
    expect(strip[0]).toBe(activity[80 - STRIP_WINDOW]);
    expect(strip[strip.length - 1]).toBe(activity[activity.length - 1]);
  });

  it("returns the whole row when it is shorter than 56 days", () => {
    const short = [true, false, true];
    expect(stripDays(short)).toEqual(short);
  });

  it("returns an empty strip when there is no activity row", () => {
    expect(stripDays([])).toEqual([]);
  });
});

describe("clampCardPosition", () => {
  it("keeps an in-bounds origin", () => {
    expect(clampCardPosition(80, 40, 1200, 800)).toEqual({ x: 80, y: 40 });
  });

  it("holds at the right and bottom viewport edges", () => {
    expect(clampCardPosition(2000, 900, 800, 600)).toEqual({
      x: 800 - USER_CARD_RIGHT_EDGE,
      y: 600 - USER_CARD_BOTTOM_EDGE,
    });
  });

  it("holds at the left and top viewport edges", () => {
    expect(clampCardPosition(-40, -12, 800, 600)).toEqual({ x: 0, y: 0 });
  });
});
