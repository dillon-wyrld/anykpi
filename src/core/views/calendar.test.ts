import { describe, expect, it } from "vitest";
import {
  classifyCalendarDate,
  eventsInRange,
  formatSyncAge,
  rollupCalendarSources,
  startOfLocalDay,
} from "./calendar-math";

describe("classifyCalendarDate", () => {
  const today = startOfLocalDay(new Date("2026-08-19T15:00:00"));

  it("marks yesterday past, tomorrow future, and today as neither", () => {
    const past = classifyCalendarDate(new Date("2026-08-18T12:00:00"), today);
    const future = classifyCalendarDate(new Date("2026-08-20T09:00:00"), today);
    const now = classifyCalendarDate(today, today);

    expect(past).toEqual({ isPast: true, isFuture: false, isToday: false });
    expect(future).toEqual({ isPast: false, isFuture: true, isToday: false });
    expect(now).toEqual({ isPast: false, isFuture: false, isToday: true });
  });

  it("uses the same < / > comparison the calendar cells paint with", () => {
    const morning = new Date(today);
    morning.setHours(8, 0, 0, 0);
    expect(classifyCalendarDate(morning, today).isFuture).toBe(true);
  });
});

describe("formatSyncAge", () => {
  const now = new Date("2026-08-19T12:00:00Z");

  it("prints live / minutes / hours / days with the existing thresholds", () => {
    expect(formatSyncAge(now, now)).toBe("live");
    expect(formatSyncAge(undefined, now)).toBe("live");
    expect(formatSyncAge(new Date(now.getTime() - 3 * 60_000), now)).toBe("3m ago");
    expect(formatSyncAge(new Date(now.getTime() - 2 * 3_600_000), now)).toBe("2h ago");
    expect(formatSyncAge(new Date(now.getTime() - 3 * 86_400_000), now)).toBe("3d ago");
  });
});

describe("range + source rollup", () => {
  const events = [
    {
      source: "stripe",
      sourceName: "Stripe",
      sourceGlyph: "💳",
      sourceColor: "#635bff",
      syncAge: "4m ago",
      date: new Date("2026-08-19T00:00:00"),
      title: "Payout",
    },
    {
      source: "stripe",
      sourceName: "Stripe",
      sourceGlyph: "💳",
      sourceColor: "#635bff",
      syncAge: "4m ago",
      date: new Date("2026-08-21T00:00:00"),
      title: "Payout 2",
    },
    {
      source: "gh",
      sourceName: "GitHub",
      sourceGlyph: "🐙",
      sourceColor: "#24292f",
      syncAge: "3m ago",
      date: new Date("2026-08-10T00:00:00"),
      title: "Release",
    },
  ];

  it("counts visible events inside the painted week", () => {
    const visible = eventsInRange(
      events,
      new Date("2026-08-17"),
      new Date("2026-08-23")
    );
    expect(visible).toHaveLength(2);
    expect(visible.map((e) => e.title)).toEqual(["Payout", "Payout 2"]);
  });

  it("rolls sources into the synced-from chips with counts", () => {
    const sources = rollupCalendarSources(events);
    expect(sources).toEqual([
      {
        id: "stripe",
        name: "Stripe",
        glyph: "💳",
        color: "#635bff",
        syncAge: "4m ago",
        count: 2,
      },
      {
        id: "gh",
        name: "GitHub",
        glyph: "🐙",
        color: "#24292f",
        syncAge: "3m ago",
        count: 1,
      },
    ]);
  });
});
