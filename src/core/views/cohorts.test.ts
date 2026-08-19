import { describe, expect, it } from "vitest";
import {
  CO_DECAY,
  CO_LEVEL,
  CO_MINSIZE,
  COHORT_COMPARE_MAX_SERIES,
  bestVintage,
  buildCohortRows,
  buildCompareSeries,
  capCohortSeries,
  coFloorOf,
  coGrade,
  coSlope,
  cohortBenchmark,
  findLeak,
  loyalCoreCount,
  parseCohortCompareOptions,
  parseCohortSeries,
  parseCohortSplit,
  periodRetention,
  pickCompareSeriesKeys,
  smileTest,
  CohortCompareLimitError,
} from "./cohort-math";
import { filterPayerUsers } from "./revenue-math";

function user(
  personId: string,
  signupDay: number,
  dailyActivity: boolean[],
  extras: { platform?: string; country?: string; cluster?: string } = {}
) {
  return { personId, name: personId, emoji: "•", signupDay, dailyActivity, ...extras };
}

describe("coSlope / coFloorOf / coGrade — existing smile rules", () => {
  it("returns a zero slope when the window is shorter than 3 points", () => {
    expect(coSlope([100, 80], 0)).toBe(0);
    expect(coSlope([100, 80, 70, 60], 2)).toBe(0);
  });

  it("fits a least-squares slope through the post-month window", () => {
    const falling = [100, 80, 70, 60, 50, 40, 30];
    const slope = coSlope(falling, 1);
    expect(slope).toBeLessThan(0);
    expect(slope).toBeCloseTo(-10, 5);
  });

  it("floors as the mean of the last five retention points", () => {
    expect(coFloorOf([40, 38, 36, 35, 34, 33])).toBe(
      (38 + 36 + 35 + 34 + 33) / 5
    );
  });

  it("marks thin cohorts young without inventing a smile", () => {
    const grade = coGrade({ retention: [100, 90, 85, 80], size: CO_MINSIZE - 1 }, 7);
    expect(grade).toMatchObject({
      state: "young",
      slope: 0,
      floor: 0,
      decay: 0,
      thin: true,
    });
  });

  it("needs 4 observations before grading", () => {
    expect(coGrade({ retention: [100, 80, 70], size: 10 }, 7).state).toBe("young");
  });

  it("calls a flattening high tail a smile and a decaying tail sliding", () => {
    const smile = coGrade(
      { retention: [100, 55, 48, 46, 45, 45, 44, 44], size: 12 },
      7
    );
    expect(smile.state).toBe("smile");
    expect(smile.floor).toBeGreaterThanOrEqual(CO_LEVEL);
    expect(smile.decay).toBeGreaterThanOrEqual(-CO_DECAY);

    const sliding = coGrade(
      { retention: [100, 70, 55, 40, 28, 18, 10, 4], size: 12 },
      7
    );
    expect(sliding.state).toBe("sliding");
    expect(sliding.decay).toBeLessThan(-CO_DECAY);
  });

  it("calls a flat-but-low tail low, not a smile", () => {
    const low = coGrade(
      { retention: [40, 24, 22, 21, 20, 20, 20, 20], size: 12 },
      7
    );
    expect(low.state).toBe("low");
    expect(low.floor).toBeLessThan(CO_LEVEL);
    expect(low.decay).toBeGreaterThanOrEqual(-CO_DECAY);
  });
});

describe("retention rows — same arrays drive the table and the curves", () => {
  it("counts a person once per period and rounds retention to a percent", () => {
    const days = [
      true, true, false, false, false, false, false,
      false, true, false, false, false, false, false,
    ];
    expect(periodRetention([{ dailyActivity: days }], 0, 7)).toEqual({
      count: 1,
      pct: 100,
    });
    expect(periodRetention([{ dailyActivity: days }], 7, 14)).toEqual({
      count: 1,
      pct: 100,
    });
    expect(periodRetention([{ dailyActivity: days }], 14, 21)).toEqual({
      count: 0,
      pct: 0,
    });
  });

  it("builds one retention[] / counts[] pair shared by the table and the chart", () => {
    const week0 = Array.from({ length: 28 }, (_, d) => d < 14);
    const week1 = Array.from({ length: 28 }, (_, d) => d >= 7 && d < 14);
    const rows = buildCohortRows(
      [
        user("a", 0, week0),
        user("b", 1, week0),
        user("c", 2, week1),
        user("d", 8, Array.from({ length: 28 }, (_, d) => d >= 8 && d < 15)),
      ],
      "week",
      28
    );

    expect(rows.map((r) => r.label)).toEqual(["W1", "W2"]);
    expect(rows[0].size).toBe(3);
    expect(rows[0].retention.length).toBe(rows[0].counts.length);
    expect(rows[0].retention[0]).toBe(
      Math.round((rows[0].counts[0] / rows[0].size) * 100)
    );

    const curvePoints = rows[0].retention.map((pct, i) => ({ i, pct }));
    const tableCells = rows[0].retention.map((pct, i) => ({
      i,
      pct,
      n: rows[0].counts[i],
    }));
    expect(curvePoints.map((p) => p.pct)).toEqual(tableCells.map((c) => c.pct));
    expect(rows[0].smileDetected).toBe(rows[0].state === "smile");
    expect(rows[0].grade.state).toBe(rows[0].state);
  });

  it("labels biweekly, monthly, and daily buckets with the existing prefixes", () => {
    const activity = Array.from({ length: 60 }, () => true);
    const users = [user("x", 0, activity), user("y", 1, activity), user("z", 2, activity)];

    expect(buildCohortRows(users, "day", 14)[0].label).toBe("D1");
    expect(buildCohortRows(users, "biweek", 28)[0].label).toBe("W1–2");
    expect(buildCohortRows(users, "month", 60)[0].label).toBe("M1");
  });
});

describe("insight cards", () => {
  const agedSmile = {
    week: 0,
    label: "W1",
    size: 20,
    retention: [100, 60, 50, 48, 47, 46, 45, 45],
    counts: [20, 12, 10, 10, 9, 9, 9, 9],
    state: "smile" as const,
    smileDetected: true,
    grade: { state: "smile" as const, slope: 0, floor: 46, decay: -0.01 },
  };
  const agedLow = {
    ...agedSmile,
    week: 1,
    label: "W2",
    state: "low" as const,
    smileDetected: false,
    grade: { ...agedSmile.grade, state: "low" as const, floor: 18 },
    retention: [100, 40, 22, 18, 17, 16, 16, 15],
    counts: [20, 8, 4, 4, 3, 3, 3, 3],
  };

  it("runs the smile test as smilers-of-aged", () => {
    const test = smileTest([agedSmile, agedLow]);
    expect(test.aged).toBe(2);
    expect(test.smilers).toBe(1);
    expect(test.low).toBe(1);
    expect(test.pmfLit).toBe(true);
    expect(
      smileTest([
        agedSmile,
        agedLow,
        { ...agedLow, state: "sliding" },
      ]).pmfLit
    ).toBe(false);
    expect(smileTest([agedSmile, { ...agedLow, state: "smile" }]).pmfLit).toBe(true);
  });

  it("finds the worst drop after week 0 as the leak", () => {
    const leak = findLeak([
      { retention: [100, 60, 55, 40] },
      { retention: [100, 70, 65, 30] },
    ]);
    expect(leak).not.toBeNull();
    expect(leak!.cliff.p).toBe(1);
    expect(leak!.cliff.drop).toBe(35);
    expect(leak!.worst.p).toBe(3);
    expect(leak!.worst.drop).toBe(25);
  });

  it("picks the best vintage at period 3 among large enough cohorts", () => {
    const winner = bestVintage([agedSmile, agedLow], 15);
    expect(winner?.vintage.label).toBe("W1");
    expect(winner?.period).toBe(3);
    expect(winner?.vintage.retention[3]).toBe(48);
  });

  it("builds the benchmark row from the same counts the table prints", () => {
    expect(cohortBenchmark([agedSmile, agedLow], 2)).toEqual([
      100,
      Math.round((100 * (12 + 8)) / 40),
    ]);
  });

  it("filters the same user list down to payers before rows are built", () => {
    const days = Array.from({ length: 14 }, () => true);
    const all = [
      user("payer-a", 0, days),
      user("free-b", 0, days),
      user("payer-c", 8, days),
    ];
    const payers = filterPayerUsers(all, ["payer-a", "payer-c"]);
    const rows = buildCohortRows(payers, "week", 14);

    expect(payers.map((u) => u.personId)).toEqual(["payer-a", "payer-c"]);
    expect(rows.map((r) => r.size)).toEqual([1, 1]);
    expect(rows[0].size + rows[1].size).toBeLessThan(all.length);
  });

  it("counts loyal-core users only when they are active every day for 8 weeks", () => {
    const loyalDays = Array.from({ length: 70 }, () => true);
    const tourist = Array.from({ length: 70 }, (_, d) => d < 10);
    const users = [
      user("loyal", 0, loyalDays),
      user("gone", 0, tourist),
    ];
    expect(loyalCoreCount(users, [agedSmile], 7)).toBe(1);
  });
});

describe("cohort compare — split series (ANY-23)", () => {
  const days = Array.from({ length: 14 }, () => true);
  const users = [
    user("ios-a", 0, days, { platform: "ios", country: "US", cluster: "power" }),
    user("ios-b", 0, days, { platform: "ios", country: "US", cluster: "power" }),
    user("and-a", 0, days, { platform: "android", country: "GB", cluster: "weekday" }),
    user("web-a", 8, days, { platform: "web", country: "DE", cluster: "occasional" }),
    user("desk-a", 8, days, { platform: "desktop", country: "FR", cluster: "fading" }),
  ];

  it("parses split and keeps the same URL/API names", () => {
    expect(parseCohortSplit("platform")).toBe("platform");
    expect(parseCohortSplit("Country")).toBe("country");
    expect(parseCohortCompareOptions({ split: "cluster" })).toEqual({
      split: "cluster",
      series: [],
    });
  });

  it("builds at most three series, largest first, when split has more keys", () => {
    const series = buildCompareSeries(users, "week", 14, "platform");
    expect(series).toHaveLength(COHORT_COMPARE_MAX_SERIES);
    expect(series.map((s) => s.key)).toEqual(["ios", "android", "desktop"]);
    expect(series[0].size).toBe(2);
    expect(series.every((s) => s.cohorts.length > 0)).toBe(true);
    expect(series.reduce((sum, s) => sum + s.size, 0)).toBeLessThan(users.length);
  });

  it("refuses a fourth series in parse, pick, and cap", () => {
    const four = ["ios", "android", "web", "desktop"];
    expect(() => parseCohortSeries(four.join(","))).toThrow(CohortCompareLimitError);
    expect(() => parseCohortCompareOptions({ split: "platform", series: four })).toThrow(
      CohortCompareLimitError
    );
    expect(() => pickCompareSeriesKeys(users, "platform", four)).toThrow(
      CohortCompareLimitError
    );
    expect(capCohortSeries(four)).toEqual(["ios", "android", "web"]);
  });

  it("keeps the payer filter when splitting (ANY-45 still applies)", () => {
    const payers = filterPayerUsers(users, ["ios-a", "and-a", "web-a", "desk-a"]);
    const series = buildCompareSeries(payers, "week", 14, "platform", [
      "ios",
      "android",
      "web",
    ]);
    expect(series.map((s) => s.key)).toEqual(["ios", "android", "web"]);
    expect(series.map((s) => s.size)).toEqual([1, 1, 1]);
    expect(payers).not.toContainEqual(expect.objectContaining({ personId: "ios-b" }));
  });
});
