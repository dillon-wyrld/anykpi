import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { loadSourceCiphertext, saveSourceConfig } from "@/core/sources";
import { loadCalendarView } from "@/core/views/calendar";
import { GET as getCalendar } from "@/app/api/v1/calendar/route";
import { POST as postConnect } from "@/app/api/v1/connect/route";
import { NextRequest } from "next/server";
import {
  expandCalendar,
  expandOccurrences,
  ICS_SOURCE,
  parseIcsCalendar,
  zonedLocalToUtc,
} from "./ics";
import { registry, sync } from "./index";
import { clearWorkspace, withOfflineSuite } from "./testing/offline";
import { fixtureDir } from "./testing";

const WS = "contract-ics";
const ICS_URL = "https://cal.example.test/private/calendar.ics";
const NOW = new Date("2026-08-19T12:00:00Z");
const ADMIN = "ics-calendar-admin";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await clearWorkspace(WS);
});

function dstFixture(): string {
  return readFileSync(
    resolve(fixtureDir("ics"), "dst-weekly.ics"),
    "utf8"
  );
}

describe("ICS recurrence across DST", () => {
  it("keeps weekly wall-clock time when America/New_York springs forward", () => {
    const events = parseIcsCalendar(dstFixture());
    const weekly = events.find((event) => event.uid === "weekly-standup@example.test");
    expect(weekly).toBeTruthy();

    const dates = expandOccurrences(weekly!, NOW);
    expect(dates).toHaveLength(8);

    const iso = dates.map((date) => date.toISOString());
    // 2026-03-08 is the US spring-forward. 10:00 stays 10:00 local;
    // UTC offset moves from -05:00 to -04:00.
    expect(iso[0]).toBe("2026-03-01T15:00:00.000Z");
    expect(iso[1]).toBe("2026-03-08T14:00:00.000Z");
    expect(iso[2]).toBe("2026-03-15T14:00:00.000Z");

    const localHours = dates.map((date) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date)
    );
    expect(new Set(localHours)).toEqual(new Set(["10:00"]));

    const before = zonedLocalToUtc("America/New_York", 2026, 3, 1, 10, 0, 0);
    const after = zonedLocalToUtc("America/New_York", 2026, 3, 8, 10, 0, 0);
    expect(before.toISOString()).toBe("2026-03-01T15:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-08T14:00:00.000Z");
  });

  it("expands the fixture calendar into the recurring series plus the one-off", () => {
    const expanded = expandCalendar(dstFixture(), NOW);
    expect(expanded.map((event) => event.title)).toContain("Weekly standup");
    expect(expanded.map((event) => event.title)).toContain("Launch review");
    expect(expanded.filter((event) => event.title === "Weekly standup")).toHaveLength(8);
  });
});

describe("ICS connector contract", () => {
  it("is registered so POST /api/v1/sync can run it", () => {
    expect(registry.ics.source).toBe(ICS_SOURCE);
    expect(registry.ics.name).toBe("Calendar");
  });

  it("stores the URL via POST /api/v1/connect and fills calendar + get_calendar", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    const connected = await postConnect(
      new NextRequest("http://localhost:3000/api/v1/connect", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          source: "ics",
          workspaceId: WS,
          credentials: { icsUrl: ICS_URL },
        }),
      })
    );
    expect(connected.status).toBe(201);
    const connectBody = await connected.json();
    expect(JSON.stringify(connectBody)).not.toContain(ICS_URL);
    expect(connectBody).toMatchObject({
      source: "ics",
      workspaceId: WS,
      connected: true,
    });

    const ciphertext = await loadSourceCiphertext(WS, ICS_SOURCE);
    expect(ciphertext).toBeTruthy();
    expect(ciphertext).toMatch(/^v1:/);
    expect(ciphertext).not.toContain(ICS_URL);
    expect(ciphertext).not.toContain("icsUrl");

    await withOfflineSuite("ics", ["ics"], async (harness) => {
      const result = await sync("ics", WS);
      expect(result).toEqual({
        rowsSynced: 9,
        nextCursor: null,
        health: "ok",
      });
      expect(harness.calls).toHaveLength(1);
      expect(harness.calls[0]?.url).toBe(ICS_URL);

      const rows = await db
        .select()
        .from(schema.calEvents)
        .where(eq(schema.calEvents.workspaceId, WS))
        .all();
      expect(rows).toHaveLength(9);
      expect(rows.every((row) => row.source === ICS_SOURCE)).toBe(true);
      expect(rows.some((row) => row.title === "Weekly standup")).toBe(true);
      expect(rows.some((row) => row.title === "Launch review")).toBe(true);

      const view = await loadCalendarView(WS);
      expect(view.events).toHaveLength(9);
      expect(view.events.every((event) => event.source === ICS_SOURCE)).toBe(true);
      expect(view.events.map((event) => event.title)).toContain("Launch review");

      process.env.ANYKPI_API_KEY = ADMIN;
      vi.stubEnv("NODE_ENV", "test");
      const res = await getCalendar(
        new NextRequest(`http://localhost:3000/api/v1/calendar?workspace=${WS}`, {
          headers: { authorization: `Bearer ${ADMIN}` },
        })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspace).toBe(WS);
      expect(body.sources).toContain(ICS_SOURCE);
      expect(body.events).toHaveLength(9);
      expect(body.events.map((event: { title: string }) => event.title)).toContain(
        "Launch review"
      );
      expect(body.view_url).toContain("view=calendar");
    });
  });

  it("returns health error on 401 and does not wipe existing events", async () => {
    await saveSourceConfig(WS, ICS_SOURCE, { icsUrl: ICS_URL });
    await db.insert(schema.calEvents).values({
      source: ICS_SOURCE,
      sourceName: "Calendar",
      sourceColor: "#2563eb",
      type: "comms",
      emoji: "📅",
      title: "Keep me",
      badge: "all day",
      eventDate: new Date("2026-08-01T00:00:00Z"),
      isFuture: false,
      workspaceId: WS,
    });

    await withOfflineSuite("ics", ["ics", "unauthorized"], async () => {
      const result = await sync("ics", WS);
      expect(result).toEqual({
        rowsSynced: 0,
        nextCursor: null,
        health: "error",
        error: "unauthorized",
      });
    });

    const rows = await db
      .select()
      .from(schema.calEvents)
      .where(eq(schema.calEvents.workspaceId, WS))
      .all();
    expect(rows.map((row) => row.title)).toEqual(["Keep me"]);
  });

  it("errors when no ICS URL is stored", async () => {
    const result = await sync("ics", WS);
    expect(result.health).toBe("error");
    expect(result.nextCursor).toBeNull();
  });
});
