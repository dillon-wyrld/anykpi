import { describe, it, expect } from "vitest";
import {
  clusterNote,
  stripDays,
  clampCardPosition,
  STRIP_DAYS,
  CARD_W,
} from "./user-card";

describe("clusterNote", () => {
  it("maps every seeded cluster to a note", () => {
    const seeded = [
      "🔥 Power daily",
      "💼 Weekday workers",
      "🌴 Weekenders",
      "🌙 Occasional",
      "🗓️ Monthly check-ins",
      "⚡ Bursty",
      "🫥 Fading away",
      "🐣 Brand new",
    ];
    for (const cluster of seeded) {
      expect(clusterNote(cluster), cluster).toBeTruthy();
    }
  });

  it("is quiet for unknown or missing clusters", () => {
    expect(clusterNote(null)).toBeNull();
    expect(clusterNote("🧪 Something else")).toBeNull();
  });
});

describe("stripDays", () => {
  it("returns the trailing window", () => {
    const activity = Array.from({ length: 168 }, (_, i) => i >= 168 - 3);
    const strip = stripDays(activity);
    expect(strip).toHaveLength(STRIP_DAYS);
    expect(strip.filter(Boolean)).toHaveLength(3);
    expect(strip[STRIP_DAYS - 1]).toBe(true);
  });

  it("handles short timelines without padding", () => {
    expect(stripDays([true, false])).toEqual([true, false]);
  });
});

describe("clampCardPosition", () => {
  it("offsets from the anchor in open space", () => {
    const pos = clampCardPosition(
      { left: 100, bottom: 200 },
      { width: 1400, height: 900 }
    );
    expect(pos).toEqual({ x: 140, y: 206 });
  });

  it("clamps at the right and bottom edges", () => {
    const pos = clampCardPosition(
      { left: 1380, bottom: 890 },
      { width: 1400, height: 900 }
    );
    expect(pos.x).toBe(1400 - (CARD_W + 20));
    expect(pos.y).toBe(900 - 190);
  });
});
