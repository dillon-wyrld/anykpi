import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { loadCalendarView } from "./views/calendar";
import {
  dedupeMilestones,
  detectMilestones,
  detectWorkspaceMilestones,
  eventMilestoneKey,
  formatBirthdayTitle,
  formatFirstSmileTitle,
  formatLongestStreakTitle,
  formatNthSignupTitle,
  foundedAtConfigKey,
  longestRunOfDays,
  mergeMilestones,
  MILESTONE_RULES,
  milestoneKey,
  parseMilestoneIdentity,
  persistWorkspaceMilestones,
  SIGNUP_THRESHOLDS,
  type DetectedMilestone,
} from "./milestones";
import { upsertConfig } from "./upsert";

const WS = "milestone-test";
const AS_OF = new Date("2026-08-19T12:00:00.000Z");
const DAY_MS = 86_400_000;

function daysAgo(n: number, from = AS_OF): Date {
  return new Date(from.getTime() - n * DAY_MS);
}

function people(count: number): Array<{
  personId: string;
  signupDate: Date;
}> {
  return Array.from({ length: count }, (_, i) => ({
    personId: `p${String(i + 1).padStart(4, "0")}`,
    signupDate: daysAgo(count - i),
  }));
}

function activityDays(
  personId: string,
  offsets: number[]
): Array<{ personId: string; timestamp: Date }> {
  return offsets.map((n) => ({ personId, timestamp: daysAgo(n) }));
}

function keysOf(rows: DetectedMilestone[]): string[] {
  return rows.map((row) => row.key).sort();
}

afterEach(async () => {
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, WS));
  await db
    .delete(schema.config)
    .where(eq(schema.config.key, foundedAtConfigKey(WS)));
});

describe("detectMilestones — pinned rules", () => {
  it("names each rule in plain words", () => {
    expect(MILESTONE_RULES.nth_signup).toBe("Nth signup");
    expect(MILESTONE_RULES.longest_streak).toBe("New longest streak");
    expect(MILESTONE_RULES.company_birthday).toBe("Company birthday");
    expect(MILESTONE_RULES.first_smile).toBe("First cohort smile");
    expect(formatNthSignupTitle(100)).toBe("100th signup");
    expect(formatNthSignupTitle(1000)).toBe("1,000th signup");
    expect(formatNthSignupTitle(10_000)).toBe("10,000th signup");
    expect(formatLongestStreakTitle(12)).toBe("New longest streak of 12 days");
    expect(formatBirthdayTitle()).toBe("Company birthday");
    expect(formatFirstSmileTitle()).toBe("First cohort smile");
  });

  it("emits Nth signup at 100 / 1,000 / 10,000 and skips unearned thresholds", () => {
    const users = people(150);
    const found = detectMilestones({
      workspaceId: WS,
      users,
      activity: [],
      asOf: AS_OF,
    });
    const nth = found.filter((m) => m.kind === "nth_signup");
    expect(nth.map((m) => m.subject)).toEqual(["100"]);
    expect(nth[0]?.title).toBe("100th signup");
    expect(nth[0]?.rule).toBe("Nth signup");
    expect(nth[0]?.occurredAt).toEqual(users[99].signupDate);
    expect(nth[0]?.key).toBe(milestoneKey(WS, "nth_signup", "100"));

    const allThree = detectMilestones({
      workspaceId: WS,
      users: people(10_000),
      activity: [],
      asOf: AS_OF,
    }).filter((m) => m.kind === "nth_signup");
    expect(allThree.map((m) => m.subject)).toEqual(
      SIGNUP_THRESHOLDS.map(String)
    );
  });

  it("emits a new longest streak from consecutive active days", () => {
    const users = people(3);
    const found = detectMilestones({
      workspaceId: WS,
      users,
      activity: [
        ...activityDays("p0001", [10, 9, 8, 7, 6]),
        ...activityDays("p0002", [4, 3, 2]),
      ],
      asOf: AS_OF,
    });
    const streak = found.find((m) => m.kind === "longest_streak");
    expect(streak?.subject).toBe("5");
    expect(streak?.title).toBe("New longest streak of 5 days");
    expect(streak?.rule).toBe("New longest streak");
    expect(streak?.occurredAt).toEqual(daysAgo(6));
  });

  it("emits the company birthday on the latest earned anniversary", () => {
    const foundedAt = new Date("2025-08-19T00:00:00.000Z");
    const found = detectMilestones({
      workspaceId: WS,
      users: people(2),
      activity: [],
      foundedAt,
      asOf: AS_OF,
    });
    const birthday = found.find((m) => m.kind === "company_birthday");
    expect(birthday?.rule).toBe("Company birthday");
    expect(birthday?.title).toBe("Company birthday");
    expect(birthday?.subject).toBe("2026");
    expect(birthday?.occurredAt.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("does not treat founding day itself as a birthday", () => {
    const foundedAt = new Date("2026-08-19T00:00:00.000Z");
    const found = detectMilestones({
      workspaceId: WS,
      users: people(2),
      activity: [],
      foundedAt,
      asOf: AS_OF,
    });
    expect(found.some((m) => m.kind === "company_birthday")).toBe(false);
  });

  it("emits the first cohort smile from a flattened retention curve", () => {
    const found = detectMilestones({
      workspaceId: WS,
      users: people(4),
      activity: [],
      asOf: AS_OF,
      cohortBaseDate: daysAgo(56),
      cohorts: [
        {
          label: "W1",
          week: 0,
          smileDetected: true,
          retention: [100, 55, 48, 46, 45, 45, 44],
        },
        {
          label: "W2",
          week: 1,
          smileDetected: true,
          retention: [100, 60, 50, 48],
        },
      ],
    });
    const smile = found.find((m) => m.kind === "first_smile");
    expect(smile?.rule).toBe("First cohort smile");
    expect(smile?.title).toBe("First cohort smile");
    expect(smile?.subject).toBe("first");
    expect(smile?.key).toBe(milestoneKey(WS, "first_smile", "first"));
  });
});

describe("idempotency", () => {
  it("re-running detection creates zero duplicates", () => {
    const input = {
      workspaceId: WS,
      users: people(120),
      activity: activityDays("p0001", [8, 7, 6, 5, 4, 3]),
      foundedAt: new Date("2025-08-19T00:00:00.000Z"),
      asOf: AS_OF,
      cohortBaseDate: daysAgo(40),
      cohorts: [
        {
          label: "W1",
          week: 0,
          smileDetected: true,
          retention: [100, 50, 46, 45, 44],
        },
      ],
    };

    const first = detectMilestones(input);
    const second = detectMilestones(input);
    expect(first.length).toBeGreaterThan(0);
    expect(keysOf(first)).toEqual(keysOf(second));
    expect(dedupeMilestones([...first, ...second])).toHaveLength(first.length);
    expect(mergeMilestones(first, second)).toHaveLength(first.length);
    expect(new Set(keysOf(first)).size).toBe(first.length);
  });

  it("parses stored calendar rows back to the same key", () => {
    const detected = detectMilestones({
      workspaceId: WS,
      users: people(100),
      activity: activityDays("p0001", [3, 2, 1]),
      foundedAt: new Date("2025-08-19T00:00:00.000Z"),
      asOf: AS_OF,
    });
    expect(detected.length).toBeGreaterThan(0);
    for (const row of detected) {
      const parsed = parseMilestoneIdentity({
        source: "anykpi",
        type: "milestone",
        title: row.title,
        eventDate: row.occurredAt,
      });
      expect(parsed).toEqual({ kind: row.kind, subject: row.subject });
      expect(eventMilestoneKey({
        source: "anykpi",
        type: "milestone",
        title: row.title,
        eventDate: row.occurredAt,
      }, WS)).toBe(row.key);
    }
  });

  it("persist twice inserts each key once", async () => {
    const users = people(120);
    await db.insert(schema.users).values(
      users.map((u) => ({
        personId: `${WS}-${u.personId}`,
        name: u.personId,
        signupDate: u.signupDate,
        workspaceId: WS,
      }))
    );
    await db.insert(schema.activity).values(
      activityDays("p0001", [5, 4, 3, 2, 1]).map((row) => ({
        personId: `${WS}-${row.personId}`,
        timestamp: row.timestamp,
        eventName: "core",
        eventClass: "core" as const,
        workspaceId: WS,
      }))
    );
    await upsertConfig({
      key: foundedAtConfigKey(WS),
      value: "2025-08-19T00:00:00.000Z",
      workspaceId: WS,
    });

    const first = await persistWorkspaceMilestones(WS, AS_OF);
    const second = await persistWorkspaceMilestones(WS, AS_OF);

    expect(first.detected.length).toBeGreaterThan(0);
    expect(second.inserted).toHaveLength(0);
    expect(keysOf(first.detected)).toEqual(keysOf(second.detected));

    const stored = await db
      .select()
      .from(schema.calEvents)
      .where(eq(schema.calEvents.workspaceId, WS))
      .all();
    const storedKeys = stored
      .map((event) => eventMilestoneKey(event, WS))
      .filter((key): key is string => key !== null);
    expect(storedKeys.sort()).toEqual(keysOf(first.detected));
    expect(new Set(storedKeys).size).toBe(storedKeys.length);

    const named = stored.filter((e) => e.source === "anykpi" && e.type === "milestone");
    expect(named.every((e) => Object.values(MILESTONE_RULES).includes(e.badge as typeof MILESTONE_RULES[keyof typeof MILESTONE_RULES]))).toBe(true);
  });

  it("loadCalendarView merges derived rows without duplicating persisted ones", async () => {
    await db.insert(schema.users).values(
      people(100).map((u) => ({
        personId: `${WS}-${u.personId}`,
        name: u.personId,
        signupDate: u.signupDate,
        workspaceId: WS,
      }))
    );
    await persistWorkspaceMilestones(WS, AS_OF);
    const view = await loadCalendarView(WS);
    const titles = view.events
      .filter((e) => e.source === "anykpi" && e.type === "milestone")
      .map((e) => e.title);
    expect(titles.filter((title) => title === "100th signup")).toHaveLength(1);
    expect(titles).toContain("100th signup");
  });
});

describe("longestRunOfDays", () => {
  it("returns the longest consecutive UTC-day run", () => {
    const start = Date.UTC(2026, 7, 1);
    const days = [0, 1, 2, 5, 6].map((n) => start + n * DAY_MS);
    const run = longestRunOfDays(days);
    expect(run?.length).toBe(3);
    expect(run?.endedAt.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });
});

describe("detectWorkspaceMilestones", () => {
  it("reads workspace rows and stays empty when nothing is earned", async () => {
    await db.insert(schema.users).values({
      personId: `${WS}-solo`,
      name: "Solo",
      signupDate: daysAgo(3),
      workspaceId: WS,
    });
    const found = await detectWorkspaceMilestones(WS, AS_OF);
    expect(found.filter((m) => m.kind === "nth_signup")).toHaveLength(0);
    expect(found.filter((m) => m.kind === "company_birthday")).toHaveLength(0);
  });
});
