import { describe, expect, it } from "vitest";
import {
  activityVector,
  activityWindow,
  activeCountOf,
  buildDotPlotUsers,
  deriveDotPlotFields,
  lastSeenOf,
  streakOf,
  utcMidnight,
} from "./dotplot";

describe("deriveDotPlotFields", () => {
  const activity = [
    false, false, true, true, true, false, true,
    true, true, true, false, false, false, false,
  ];

  it("counts active days, trailing streak, and last-seen from one vector", () => {
    const fields = deriveDotPlotFields(2, activity);

    expect(fields.activeCount).toBe(activeCountOf(activity));
    expect(fields.activeCount).toBe(7);
    expect(fields.streak).toBe(streakOf(activity));
    expect(fields.streak).toBe(0);
    expect(fields.lastSeen).toBe(lastSeenOf(activity));
    expect(fields.lastSeen).toBe(4);
    expect(fields.cohortMonth).toBe(0);
    expect(fields.isNew).toBe(false);
    expect(fields.paid).toBe(false);
    expect(fields.churned).toBe(false);
  });

  it("marks a late signup as new and a long gap as churned", () => {
    const quiet = [true, false, false, false, false, false, false, false, false, false, false, false, false, false, false, false];
    const fields = deriveDotPlotFields(22, quiet);
    expect(fields.isNew).toBe(true);
    expect(fields.churned).toBe(true);
    expect(fields.cohortMonth).toBe(0);
    expect(fields.lastSeen).toBe(15);
  });

  it("counts a trailing streak from the last cell", () => {
    expect(streakOf([true, true, false, true, true, true])).toBe(3);
    expect(streakOf([false, false, false])).toBe(0);
    expect(lastSeenOf([false, false, false])).toBe(-1);
  });

  it("buckets signup offset into 28-day cohort months", () => {
    expect(deriveDotPlotFields(0, []).cohortMonth).toBe(0);
    expect(deriveDotPlotFields(27, []).cohortMonth).toBe(0);
    expect(deriveDotPlotFields(28, []).cohortMonth).toBe(1);
    expect(deriveDotPlotFields(56, []).cohortMonth).toBe(2);
  });
});

describe("activityVector / activityWindow", () => {
  it("builds a boolean row from day offsets and ignores out-of-range days", () => {
    expect(activityVector([0, 2, 99], 4)).toEqual([true, false, true, false]);
  });

  it("opens the window at UTC midnight of the earliest date and is at least 28 days", () => {
    const start = new Date(Date.UTC(2026, 0, 5, 15, 30));
    const end = new Date(Date.UTC(2026, 0, 10, 3, 0));
    const { baseDate, endDate, totalDays } = activityWindow([start, end]);

    expect(baseDate).toEqual(utcMidnight(start));
    expect(endDate).toEqual(new Date(Date.UTC(2026, 0, 11)));
    expect(totalDays).toBe(28);
  });
});

describe("buildDotPlotUsers", () => {
  it("derives every on-screen field from signup + activity timestamps", () => {
    const base = new Date(Date.UTC(2026, 2, 1));
    const users = [
      { personId: "dave", name: "Dave", signupDate: base },
      { personId: "mia", name: "Mia", signupDate: new Date(Date.UTC(2026, 2, 23)) },
    ];
    const activities = [
      { personId: "dave", timestamp: new Date(Date.UTC(2026, 2, 1)) },
      { personId: "dave", timestamp: new Date(Date.UTC(2026, 2, 2)) },
      { personId: "dave", timestamp: new Date(Date.UTC(2026, 2, 3)) },
      { personId: "mia", timestamp: new Date(Date.UTC(2026, 2, 23)) },
    ];

    const [dave, mia] = buildDotPlotUsers(users, activities);

    expect(dave.signupOffset).toBe(0);
    expect(dave.activeCount).toBe(3);
    expect(dave.activity[0]).toBe(true);
    expect(dave.activity[1]).toBe(true);
    expect(dave.activity[2]).toBe(true);
    expect(dave.streak).toBe(0);
    expect(dave.cohortMonth).toBe(0);
    expect(dave.isNew).toBe(false);

    expect(mia.signupOffset).toBe(22);
    expect(mia.isNew).toBe(true);
    expect(mia.activeCount).toBe(1);
    expect(mia.activity[22]).toBe(true);
  });
});
