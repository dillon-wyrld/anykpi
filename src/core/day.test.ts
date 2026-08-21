import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getOverview } from "@/app/api/v1/overview/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadCalendarView } from "@/core/views/calendar";
import { foundedAtConfigKey } from "@/core/milestones";
import { upsertConfig } from "@/core/upsert";
import {
  anniversaryOnOrBefore,
  civilDateInZone,
  computeDayClock,
  dayClockFields,
  dayNumber,
  earnedDayMilestones,
  homeTimezoneConfigKey,
  isDayMilestone,
  nextMilestoneDay,
  timeLeftToday,
  weekNumber,
  workspaceDayClock,
} from "./day";

const root = resolve(__dirname, "../..");
const ADMIN = "day-clock-admin";
const WS = "day-clock-agree";
const FOUNDED = new Date("2025-03-15T00:00:00.000Z");
const NOW = new Date("2026-03-15T12:00:00.000Z");
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  vi.useRealTimers();
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
  await db.delete(schema.calEvents).where(eq(schema.calEvents.workspaceId, WS));
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walkTsFiles(full, acc);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

const INLINE_DAY_ARITHMETIC = [
  /dayN\s*:\s*Math\.floor/,
  /new Date\(\s*["']2024-01-01["']\s*\)/,
  /\(\s*new Date\(\)\.getTime\(\)\s*-\s*new Date\([^)]+\)\.getTime\(\)\s*\)\s*\/\s*\(?\s*1000\s*\*\s*60\s*\*\s*60\s*\*\s*24/,
];

describe("no inline day arithmetic outside src/core/day.ts", () => {
  it("keeps company-day math in day.ts", () => {
    const allowed = new Set([
      resolve(__dirname, "day.ts"),
      resolve(__dirname, "day.test.ts"),
    ]);
    const offenders: string[] = [];
    for (const file of walkTsFiles(resolve(root, "src"))) {
      if (allowed.has(file)) continue;
      const src = readFileSync(file, "utf8");
      if (INLINE_DAY_ARITHMETIC.some((pattern) => pattern.test(src))) {
        offenders.push(relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("overview, MCP, and milestones import the shared clock", () => {
    const consumers = [
      "src/mcp/server.ts",
      "src/app/api/mcp/route.ts",
      "src/app/api/v1/overview/route.ts",
      "src/core/milestones.ts",
    ];
    for (const rel of consumers) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src, rel).toMatch(/from ["']@\/core\/day["']/);
    }
  });
});

describe("day clock — local civil dates", () => {
  it("treats founding day as Day 0 with Week 1 and the 100 ladder", () => {
    const founded = new Date("2026-08-20T09:00:00.000Z");
    const clock = computeDayClock({
      foundedAt: founded,
      now: founded,
      timeZone: "UTC",
    });
    expect(clock.dayN).toBe(0);
    expect(clock.weekN).toBe(1);
    expect(clock.nextMilestone).toBe(100);
    expect(clock.timeLeftMs).toBeGreaterThan(0);
    expect(clock.timeLeftLabel).toMatch(/^\d+h \d+m$/);
  });

  it("counts a leap day as a real local day", () => {
    expect(
      dayNumber(
        new Date("2024-02-28T00:00:00.000Z"),
        new Date("2024-03-01T00:00:00.000Z"),
        "UTC"
      )
    ).toBe(2);
    expect(
      dayNumber(
        new Date("2025-02-28T00:00:00.000Z"),
        new Date("2025-03-01T00:00:00.000Z"),
        "UTC"
      )
    ).toBe(1);
    expect(
      dayNumber(
        new Date("2024-02-29T00:00:00.000Z"),
        new Date("2028-02-29T00:00:00.000Z"),
        "UTC"
      )
    ).toBe(1461);
  });

  it("does not skip or double a day across US DST boundaries", () => {
    const springFounded = new Date("2026-03-07T17:00:00.000Z"); // Mar 7 12:00 NY
    const springNow = new Date("2026-03-09T16:00:00.000Z"); // Mar 9 12:00 NY
    expect(dayNumber(springFounded, springNow, "America/New_York")).toBe(2);

    const fallFounded = new Date("2026-10-31T16:00:00.000Z"); // Oct 31 12:00 NY
    const fallNow = new Date("2026-11-02T17:00:00.000Z"); // Nov 2 12:00 NY
    expect(dayNumber(fallFounded, fallNow, "America/New_York")).toBe(2);

    const springLeft = timeLeftToday(
      new Date("2026-03-08T06:30:00.000Z"), // Mar 8 01:30 EST, 2am skipped
      "America/New_York"
    );
    expect(springLeft.hours).toBe(21);
    expect(springLeft.minutes).toBe(30);

    const fallLeft = timeLeftToday(
      new Date("2026-11-01T04:30:00.000Z"), // Nov 1 00:30 EDT, 1am repeats
      "America/New_York"
    );
    expect(fallLeft.hours).toBe(24);
    expect(fallLeft.minutes).toBe(30);
  });

  it("uses Bangalore (UTC+5:30) civil midnights, not elapsed UTC hours", () => {
    const founded = new Date("2026-06-15T18:30:00.000Z"); // Jun 16 00:00 IST
    const sameLocalDay = new Date("2026-06-16T18:29:00.000Z"); // Jun 16 23:59 IST
    const nextLocalDay = new Date("2026-06-16T18:30:00.000Z"); // Jun 17 00:00 IST
    expect(dayNumber(founded, sameLocalDay, "Asia/Kolkata")).toBe(0);
    expect(dayNumber(founded, nextLocalDay, "Asia/Kolkata")).toBe(1);
    expect(civilDateInZone(founded, "Asia/Kolkata")).toEqual({
      year: 2026,
      month: 6,
      day: 16,
    });

    const lateEvening = new Date("2026-06-16T18:00:00.000Z"); // Jun 16 23:30 IST
    const left = timeLeftToday(lateEvening, "Asia/Kolkata");
    expect(left.hours).toBe(0);
    expect(left.minutes).toBe(30);
  });

  it("keeps Day N honest past 9,999 and steps the ladder by centuries", () => {
    const dayN = dayNumber(
      new Date("1990-01-01T00:00:00.000Z"),
      new Date("2026-01-01T00:00:00.000Z"),
      "UTC"
    );
    expect(dayN).toBeGreaterThan(9_999);
    expect(dayN).toBe(13_149);
    expect(weekNumber(dayN)).toBe(Math.floor(13_149 / 7) + 1);
    expect(nextMilestoneDay(9_999)).toBe(10_000);
    expect(nextMilestoneDay(10_000)).toBe(10_100);
    expect(nextMilestoneDay(364)).toBe(365);
    expect(nextMilestoneDay(365)).toBe(500);
    expect(nextMilestoneDay(999)).toBe(1_000);
    expect(nextMilestoneDay(1_000)).toBe(1_100);
    expect(isDayMilestone(365)).toBe(true);
    expect(isDayMilestone(1000)).toBe(true);
    expect(isDayMilestone(364)).toBe(false);
    expect(isDayMilestone(1100)).toBe(true);
    expect(earnedDayMilestones(365)).toEqual([100, 200, 300, 365]);
    expect(earnedDayMilestones(99)).toEqual([]);
  });

  it("earns the birthday on the home-timezone anniversary, not UTC midnight", () => {
    const founded = new Date("2025-06-15T18:30:00.000Z"); // Jun 16 00:00 IST
    const stillFifteenth = new Date("2026-06-15T18:00:00.000Z"); // Jun 15 23:30 IST
    const sixteenth = new Date("2026-06-15T18:30:00.000Z"); // Jun 16 00:00 IST
    expect(anniversaryOnOrBefore(founded, stillFifteenth, "Asia/Kolkata")).toBeNull();
    expect(
      anniversaryOnOrBefore(founded, sixteenth, "Asia/Kolkata")?.toISOString()
    ).toBe("2026-06-16T00:00:00.000Z");
  });
});

describe("MCP, REST, and calendar birthday share one fixture", () => {
  async function seedAnchor() {
    await upsertConfig({
      key: foundedAtConfigKey(WS),
      value: FOUNDED.toISOString(),
      workspaceId: WS,
    });
    await upsertConfig({
      key: homeTimezoneConfigKey(WS),
      value: "UTC",
      workspaceId: WS,
    });
  }

  async function callOverview() {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    const response = await getOverview(
      new NextRequest(`http://localhost:3000/api/v1/overview?workspace=${WS}`, {
        headers: { authorization: `Bearer ${ADMIN}` },
      })
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      dayN: number;
      weekN: number;
      nextMilestone: number;
      todayMilestone: {
        key: string;
        title: string;
        source: string;
        occurredAt: string;
      } | null;
    }>;
  }

  async function callMcpOverview() {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    const response = await postMcp(
      new NextRequest("http://localhost:3000/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_overview", arguments: { workspace: WS } },
        }),
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result?: { content?: { text?: string }[] };
      error?: unknown;
    };
    expect(body.error).toBeUndefined();
    return JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
      dayN: number;
      weekN: number;
      nextMilestone: number;
      todayMilestone: {
        key: string;
        title: string;
        source: string;
        occurredAt: string;
      } | null;
    };
  }

  it("returns the same Day N and birthday for one founded date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    await seedAnchor();

    const expected = dayClockFields(
      await workspaceDayClock(WS, { foundedAt: FOUNDED, now: NOW })
    );
    expect(expected.dayN).toBe(365);
    expect(expected.weekN).toBe(53);
    expect(expected.nextMilestone).toBe(500);

    const rest = await callOverview();
    const mcp = await callMcpOverview();
    const calendar = await loadCalendarView(WS);
    const birthday = calendar.events.find(
      (event) => event.source === "anykpi" && event.title === "Company birthday"
    );
    const day365 = calendar.events.find(
      (event) => event.source === "anykpi" && event.title === "Day 365"
    );

    expect(rest.dayN).toBe(expected.dayN);
    expect(mcp.dayN).toBe(expected.dayN);
    expect(rest.weekN).toBe(expected.weekN);
    expect(mcp.weekN).toBe(expected.weekN);
    expect(rest.nextMilestone).toBe(expected.nextMilestone);
    expect(mcp.nextMilestone).toBe(expected.nextMilestone);
    expect(birthday?.date).toBe("2026-03-15T00:00:00.000Z");
    expect(day365?.date).toBe("2026-03-15T00:00:00.000Z");
    expect(rest.todayMilestone?.title).toBe("Day 365");
    expect(rest.todayMilestone?.source).toBe("anykpi");
    expect(rest.todayMilestone?.occurredAt).toBe(day365?.date);
    expect(mcp.todayMilestone?.key).toBe(rest.todayMilestone?.key);
    expect(anniversaryOnOrBefore(FOUNDED, NOW, "UTC")?.toISOString()).toBe(
      birthday?.date
    );
  });
});

describe("day clock helpers", () => {
  it("formats time-left the way the prototype bar reads", () => {
    const left = timeLeftToday(
      new Date("2026-03-15T12:00:00.000Z"),
      "UTC"
    );
    expect(left.hours).toBe(12);
    expect(left.minutes).toBe(0);
    expect(left.label).toBe("12h 0m");
    expect(left.ms).toBe(12 * 60 * 60 * 1000);
  });

  it("falls through an unknown zone to UTC", () => {
    expect(
      dayNumber(
        new Date("2026-01-01T00:00:00.000Z"),
        new Date("2026-01-03T00:00:00.000Z"),
        "Not/AZone"
      )
    ).toBe(2);
  });
});
