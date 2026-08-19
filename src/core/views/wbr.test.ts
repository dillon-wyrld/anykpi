import { describe, expect, it } from "vitest";
import { WBR_METRICS } from "@/demo/generators";
import {
  seriesPctChange,
  seriesWowYoy,
  sheetPct,
  sheetTint,
  wbrBox,
  wbrExceptions,
  wbrSheet,
  wbrStat,
  wfmt,
  wsign,
  type WbrMetricLike,
} from "./wbr-math";

function metric(
  partial: Partial<WbrMetricLike> & Pick<WbrMetricLike, "weeks">
): WbrMetricLike {
  return {
    prevWeeks: [0, 0, 0, 0, 0, 0],
    months: Array(12).fill(0),
    prevMonths: Array(12).fill(0),
    target: 50,
    goodDir: 1,
    type: "output",
    unit: "",
    dp: 0,
    ...partial,
  };
}

describe("wbrStat — exception engine", () => {
  it("is ok when an output stays on the right side of target", () => {
    const stat = wbrStat(metric({ weeks: [45, 47, 46, 48, 49, 50], target: 50 }));
    expect(stat.k).toBe("ok");
    expect(stat.why).toContain("one-second glance");
  });

  it("watches the first miss and names last week against the target", () => {
    const stat = wbrStat(
      metric({ weeks: [50, 52, 51, 53, 52, 48], target: 50, type: "input" })
    );
    expect(stat.k).toBe("watch");
    expect(stat.why).toContain("first week off target");
    expect(stat.why).toContain("48");
    expect(stat.why).toContain("50");
  });

  it("flags two or more consecutive misses as off", () => {
    const stat = wbrStat(metric({ weeks: [50, 52, 48, 46, 45, 44], target: 50 }));
    expect(stat.k).toBe("off");
    expect(stat.why).toContain("weeks off target");
  });

  it("respects goodDir for downward targets", () => {
    const stat = wbrStat(
      metric({ weeks: [500, 480, 460, 440, 420, 400], target: 450, goodDir: -1 })
    );
    expect(stat.k).toBe("ok");
  });

  it("watches an input that is on target but turning the wrong way", () => {
    const stat = wbrStat(
      metric({
        weeks: [60, 58, 56, 54, 52, 50],
        target: 45,
        type: "input",
      })
    );
    expect(stat.k).toBe("watch");
    expect(stat.why).toContain("turning the wrong way");
  });
});

describe("wbrBox / seriesWowYoy — LW, WoW, YoY", () => {
  const weeks = [820, 905, 870, 1010, 1150, 1240];
  const prevWeeks = [340, 360, 330, 400, 420, 455];

  it("prints last week from weeks[5] and integer WoW / YoY on the card", () => {
    const box = wbrBox(
      metric({ weeks, prevWeeks, target: 1200, goodDir: 1 })
    );
    expect(box.lw).toBe(1240);
    expect(box.wow).toBe(Math.round(((1240 - 1150) / 1150) * 100));
    expect(box.yoy).toBe(Math.round(((1240 - 455) / 455) * 100));
    expect(box.on).toBe(true);
  });

  it("computes the API series WoW / YoY from the same week arrays", () => {
    const series = seriesWowYoy(weeks, prevWeeks);
    expect(series.current).toBe(1240);
    expect(series.wow).toBe(seriesPctChange(1240, 1150));
    expect(series.yoy).toBe(seriesPctChange(1240, 455));
  });

  it("treats a zero baseline as 0% in the series helper", () => {
    expect(seriesPctChange(10, 0)).toBe(0);
  });
});

describe("wbrSheet — golden: same arrays drive chart and table", () => {
  const m = metric({
    weeks: [12, 15, 11, 19, 17, 22],
    prevWeeks: [5, 6, 4, 7, 6, 8],
    months: [10, 12, 11, 14, 13, 15, 16, 18, 17, 19, 20, 22],
    prevMonths: [4, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8, 10],
    unit: "",
    dp: 0,
    goodDir: 1,
    target: 16,
  });

  it("reuses the chart series as the value row", () => {
    const sheet = wbrSheet(m);
    expect(sheet.weeks).toBe(m.weeks);
    expect(sheet.months).toBe(m.months);
    expect(sheet.prevWeeks).toBe(m.prevWeeks);
    expect(sheet.prevMonths).toBe(m.prevMonths);
  });

  it("derives PoP and YoY only from those series", () => {
    const sheet = wbrSheet(m);
    expect(sheet.weekPop[0]).toBeNull();
    expect(sheet.weekPop[5]).toBe(sheetPct(m.weeks[5], m.weeks[4]));
    expect(sheet.weekYoy[5]).toBe(sheetPct(m.weeks[5], m.prevWeeks[5]));
    expect(sheet.monthPop[0]).toBeNull();
    expect(sheet.monthYoy[11]).toBe(sheetPct(m.months[11], m.prevMonths[11]));
    expect(sheet.t12).toBe(m.months.reduce((s, v) => s + v, 0));
    expect(sheet.t12Yoy).toBe(sheetPct(sheet.t12, sheet.p12));
  });

  it("averages rates and sums volumes for T12M", () => {
    const rate = wbrSheet(metric({ ...m, unit: "%", dp: 1, months: [10, 20] }));
    expect(rate.t12).toBe(15);
    const money = wbrSheet(metric({ ...m, unit: "$", months: [10, 20] }));
    expect(money.t12).toBe(30);
  });

  it("tints a move by goodDir so a falling down-metric is good", () => {
    expect(sheetTint(10, 1)).toContain("94,106,210");
    expect(sheetTint(-10, 1)).toContain("212,61,81");
    expect(sheetTint(-10, -1)).toContain("94,106,210");
    expect(sheetTint(null, 1)).toBe("");
  });
});

describe("canon WBR_METRICS — every metric on the deck", () => {
  it("grades all 21 seeded metrics and formats the box score from the same weeks", () => {
    const graded = WBR_METRICS.map((m) => {
      const like: WbrMetricLike = {
        weeks: m.weeks,
        prevWeeks: m.prevWeeks,
        months: m.months ?? [],
        prevMonths: m.prevMonths ?? [],
        target: m.target,
        goodDir: m.goodDir,
        type: m.type,
        unit: m.unit,
        dp: m.dp,
      };
      return {
        name: m.name,
        stat: wbrStat(like),
        box: wbrBox(like),
        sheet: wbrSheet(like),
      };
    });

    expect(graded).toHaveLength(21);
    expect(new Set(graded.map((g) => g.stat.k))).toEqual(
      new Set(["ok", "watch", "off"])
    );

    graded.forEach((g) => {
      expect(g.box.lw).toBe(g.sheet.weeks[5]);
      expect(g.sheet.weeks).toHaveLength(6);
      expect(g.sheet.months).toHaveLength(12);
      expect(wsign(g.box.wow)).toMatch(/%$/);
      expect(wfmt(g.box.lw, { dp: 0, unit: "" })).toBe(Number(g.box.lw).toFixed(0));
    });

    const exceptions = wbrExceptions(graded);
    expect(exceptions.every((m) => m.stat.k !== "ok")).toBe(true);
    expect(exceptions.length).toBeGreaterThan(0);
  });

  it("keeps Weekly Revenue's printed LW / WoW / YoY pinned", () => {
    const revenue = WBR_METRICS.find((m) => m.name === "Weekly Revenue")!;
    const box = wbrBox({
      weeks: revenue.weeks,
      prevWeeks: revenue.prevWeeks,
      target: revenue.target,
      goodDir: revenue.goodDir,
    });
    expect(box.lw).toBe(1240);
    expect(box.wow).toBe(8);
    expect(box.yoy).toBe(173);
    expect(wfmt(box.lw, { dp: 0, unit: "$" })).toBe("$1240");
  });
});
