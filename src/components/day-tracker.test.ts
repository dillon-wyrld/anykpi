import { describe, expect, it, vi } from "vitest";
import type { OverviewResponse, Presence } from "@/core/contracts";
import { computeDayClock, dayClockFields } from "@/core/day";
import {
  buildDayTrackerSnapshot,
  dayTrackerSignature,
  formatFreshnessChip,
  formatLocalClock,
  isNightHour,
  needlePlacement,
  shouldUseDemoCast,
  type DayTrackerProfile,
} from "@/components/day-tracker";
import { createDayTrackerTicker } from "@/components/day-tracker-tick";

const YOURCO: DayTrackerProfile = {
  companyName: "YourCo",
  dayLabel: "Day of YourCo",
  foundedAt: "2026-03-14T00:00:00.000Z",
  homeCity: { timezone: "UTC", label: "UTC" },
};

function emptyPresence(): Presence {
  return {
    asOf: null,
    online: 0,
    cameOnline: 0,
    droppedOff: 0,
    unplaced: 0,
    unplacedOnline: 0,
    cities: [],
  };
}

function overviewFixture(
  patch: Partial<OverviewResponse> = {}
): OverviewResponse {
  return {
    workspace: "live",
    dayN: 0,
    weekN: 1,
    timeLeftToday: "24h 0m",
    nextMilestone: 100,
    totalUsers: 0,
    activeToday: 0,
    weeklyActive: 0,
    retentionRate: 0,
    smileDetected: false,
    exceptionsCount: 0,
    upcomingEvents: 0,
    syncHealth: [],
    presence: emptyPresence(),
    ...patch,
  };
}

describe("day clock rollover at local midnight", () => {
  it("rolls Day N and time-left at UTC midnight", () => {
    const foundedAt = new Date(YOURCO.foundedAt!);
    const beforeClock = computeDayClock({
      foundedAt,
      now: new Date("2026-03-14T23:59:00.000Z"),
      timeZone: "UTC",
    });
    const afterClock = computeDayClock({
      foundedAt,
      now: new Date("2026-03-15T00:00:00.000Z"),
      timeZone: "UTC",
    });
    expect(beforeClock.dayN).toBe(0);
    expect(beforeClock.timeLeftLabel).toBe("0h 1m");
    expect(afterClock.dayN).toBe(1);
    expect(afterClock.timeLeftLabel).toBe("24h 0m");

    const before = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: YOURCO,
      overview: overviewFixture({
        workspace: "demo",
        ...dayClockFields(beforeClock),
      }),
      now: new Date("2026-03-14T23:59:00.000Z"),
    });
    const after = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: YOURCO,
      overview: overviewFixture({
        workspace: "demo",
        ...dayClockFields(afterClock),
      }),
      now: new Date("2026-03-15T00:00:00.000Z"),
    });
    expect(before.dayN).toBe(0);
    expect(before.timeLeftLabel).toBe("0h 1m");
    expect(after.dayN).toBe(1);
    expect(after.timeLeftLabel).toBe("24h 0m");
    expect(after.signature).not.toBe(before.signature);
  });

  it("rolls at the home-city midnight, not UTC", () => {
    const foundedAt = new Date("2026-03-14T08:00:00.000Z");
    const before = computeDayClock({
      foundedAt,
      now: new Date("2026-03-15T06:59:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    const after = computeDayClock({
      foundedAt,
      now: new Date("2026-03-15T07:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
    expect(before.dayN).toBe(0);
    expect(before.timeLeftLabel).toBe("0h 1m");
    expect(after.dayN).toBe(1);
    expect(after.timeLeftLabel).toBe("24h 0m");
  });
});

describe("signature guard", () => {
  it("stays put when the clock and tallies have not moved", () => {
    const now = new Date("2026-08-20T18:00:00.000Z");
    const first = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: YOURCO,
      overview: overviewFixture({ workspace: "demo" }),
      now,
    });
    const second = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: YOURCO,
      overview: overviewFixture({ workspace: "demo" }),
      now,
    });
    expect(second.signature).toBe(first.signature);
    expect(
      dayTrackerSignature({
        dayN: first.dayN,
        timeLeftLabel: first.timeLeftLabel,
        demo: first.demo,
        online: Number(first.stats.find((s) => s.label === "Online")?.value),
        shown: first.cities.filter((c) => first.shownKeys.includes(c.key)),
        freshnessLabel: first.freshnessLabel,
      })
    ).toBe(first.signature);
  });

  it("changes when the minute of time-left rolls", () => {
    const noon = computeDayClock({
      foundedAt: new Date(YOURCO.foundedAt!),
      now: new Date("2026-03-14T12:00:00.000Z"),
      timeZone: "UTC",
    });
    const nextMinute = computeDayClock({
      foundedAt: new Date(YOURCO.foundedAt!),
      now: new Date("2026-03-14T12:01:00.000Z"),
      timeZone: "UTC",
    });
    const a = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: YOURCO,
      overview: overviewFixture({
        workspace: "demo",
        ...dayClockFields(noon),
      }),
      now: new Date("2026-03-14T12:00:00.000Z"),
    });
    const b = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: YOURCO,
      overview: overviewFixture({
        workspace: "demo",
        ...dayClockFields(nextMinute),
      }),
      now: new Date("2026-03-14T12:01:00.000Z"),
    });
    expect(a.timeLeftLabel).toBe("12h 0m");
    expect(b.timeLeftLabel).toBe("11h 59m");
    expect(b.signature).not.toBe(a.signature);
  });
});

describe("demo cast vs synced presence", () => {
  it("uses the demo cast for demo and for a workspace with no data", () => {
    expect(shouldUseDemoCast("demo", overviewFixture({ workspace: "demo" }))).toBe(
      true
    );
    expect(shouldUseDemoCast("live", overviewFixture())).toBe(true);
    expect(
      shouldUseDemoCast(
        "live",
        overviewFixture({
          totalUsers: 2,
          presence: {
            ...emptyPresence(),
            asOf: "2026-08-20T18:00:00.000Z",
            online: 1,
          },
        })
      )
    ).toBe(false);
  });

  it("labels the demo snapshot and omits the freshness chip", () => {
    const snap = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: {
        ...YOURCO,
        homeCity: { timezone: "America/Los_Angeles", label: "San Francisco" },
      },
      overview: overviewFixture({ workspace: "demo" }),
      now: new Date("2026-08-20T18:00:00.000Z"),
    });
    expect(snap.demo).toBe(true);
    expect(snap.freshnessLabel).toBeNull();
    expect(snap.dayLabel).toBe("Day of YourCo");
    expect(snap.shownKeys.length).toBe(3);
    expect(snap.cities[0]?.home).toBe(true);
    expect(snap.stats.map((s) => s.label)).toEqual([
      "Week",
      "Online",
      "Next up",
      "Spread",
    ]);
  });

  it("shows real tallies and a freshness chip on a synced workspace", () => {
    const now = new Date("2026-08-20T18:05:00.000Z");
    const snap = buildDayTrackerSnapshot({
      workspace: "live",
      profile: {
        companyName: "Harbor",
        dayLabel: "Day of Harbor",
        foundedAt: "2026-01-01T00:00:00.000Z",
        homeCity: { timezone: "America/Los_Angeles", label: "San Francisco" },
      },
      overview: overviewFixture({
        workspace: "live",
        totalUsers: 4,
        presence: {
          asOf: "2026-08-20T18:00:00.000Z",
          online: 2,
          cameOnline: 1,
          droppedOff: 0,
          unplaced: 0,
          unplacedOnline: 0,
          cities: [
            {
              city: "San Francisco",
              country: "US",
              timezone: "America/Los_Angeles",
              users: 3,
              online: 2,
              cameOnline: 1,
              droppedOff: 0,
              home: true,
            },
            {
              city: "London",
              country: "GB",
              timezone: "Europe/London",
              users: 1,
              online: 0,
              cameOnline: 0,
              droppedOff: 0,
              home: false,
            },
          ],
        },
      }),
      now,
    });
    expect(snap.demo).toBe(false);
    expect(snap.freshnessLabel).toBe("5m ago");
    expect(snap.stats.find((s) => s.label === "Online")?.value).toBe("2");
    expect(snap.dayLabel).toBe("Day of Harbor");
  });
});

describe("needle and night language", () => {
  it("flips the label anchor near the ends of the bar", () => {
    expect(needlePlacement(0.1).anchor).toBe("l");
    expect(needlePlacement(12).anchor).toBe("");
    expect(needlePlacement(23.8).anchor).toBe("r");
    expect(needlePlacement(0).x).toBe(0.6);
    expect(needlePlacement(24).x).toBe(99.4);
  });

  it("formats the local clock the way the prototype bar reads", () => {
    expect(formatLocalClock(0)).toBe("12:00am");
    expect(formatLocalClock(6.5)).toBe("6:30am");
    expect(formatLocalClock(12)).toBe("12:00pm");
    expect(formatLocalClock(21.5)).toBe("9:30pm");
    expect(isNightHour(3)).toBe(true);
    expect(isNightHour(12)).toBe(false);
    expect(isNightHour(21.5)).toBe(true);
  });
});

describe("freshness chip", () => {
  it("prints whole minutes, never a ticking decimal", () => {
    const now = new Date("2026-08-20T18:00:00.000Z");
    expect(formatFreshnessChip("2026-08-20T17:59:30.000Z", now)).toBe("just now");
    expect(formatFreshnessChip("2026-08-20T17:47:00.000Z", now)).toBe("13m ago");
    expect(formatFreshnessChip("2026-08-20T16:00:00.000Z", now)).toBe("2h ago");
  });
});

describe("hidden tab pauses the tick", () => {
  it("schedules zero re-renders and zero fetches while hidden", async () => {
    let hidden = true;
    let fetches = 0;
    let paints = 0;
    const ticker = createDayTrackerTicker({
      isHidden: () => hidden,
      onTick: () => {
        fetches += 1;
        paints += 1;
      },
      setIntervalFn: () => 1 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => undefined,
    });

    await ticker.mount();
    await ticker.tick();
    ticker.start();

    expect(fetches).toBe(0);
    expect(paints).toBe(0);
    expect(ticker.counts().scheduled).toBe(false);

    hidden = false;
    await ticker.handleVisibility();
    expect(fetches).toBe(1);
    expect(paints).toBe(1);

    hidden = true;
    ticker.handleVisibility();
    await ticker.tick();
    expect(fetches).toBe(1);
    expect(paints).toBe(1);
    ticker.dispose();
  });

  it("does not paint twice when the signature is unchanged", () => {
    const now = new Date("2026-08-20T18:00:00.000Z");
    const first = buildDayTrackerSnapshot({
      workspace: "demo",
      profile: YOURCO,
      overview: overviewFixture({ workspace: "demo" }),
      now,
    });
    let paints = 0;
    let known = "";
    const apply = (sig: string) => {
      if (sig === known) return;
      known = sig;
      paints += 1;
    };
    apply(first.signature);
    apply(
      buildDayTrackerSnapshot({
        workspace: "demo",
        profile: YOURCO,
        overview: overviewFixture({ workspace: "demo" }),
        now,
      }).signature
    );
    expect(paints).toBe(1);
  });
});

describe("house rules", () => {
  it("does not schedule a sub-minute interval", () => {
    const setIntervalFn = vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>);
    const ticker = createDayTrackerTicker({
      isHidden: () => false,
      onTick: () => undefined,
      setIntervalFn,
      clearIntervalFn: () => undefined,
    });
    ticker.start();
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 60_000);
    ticker.dispose();
  });
});
