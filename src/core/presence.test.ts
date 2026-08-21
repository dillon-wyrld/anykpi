import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getOverview } from "@/app/api/v1/overview/route";
import { POST as postMcp } from "@/app/api/mcp/route";
import {
  OverviewResponseSchema,
  PresenceCitySchema,
  PresenceSchema,
  type Presence,
} from "@/core/contracts";
import { DEMO_HOME_CITY } from "@/core/company-day";
import { saveCompanyProfile } from "@/core/company-profile";
import { HOUR_MS } from "@/core/day";
import { db } from "@/core/db";
import { computePresence, loadWorkspacePresence } from "@/core/presence";
import * as schema from "@/core/schema";
import { NAMED } from "@/demo/generators";

const root = resolve(__dirname, "../..");
const WS = "presence-golden";
const ADMIN = "presence-admin";
const originalKey = process.env.ANYKPI_API_KEY;

/** Fixed T so demo-seed golden numbers do not depend on wall clock. */
const T = new Date("2026-08-20T18:00:00.000Z");

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
  await db.delete(schema.activity).where(eq(schema.activity.workspaceId, WS));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, WS));
});

function ago(minutes: number): Date {
  return new Date(T.getTime() - minutes * 60_000);
}

function named(name: string): { name: string; emoji: string } {
  const row = NAMED.find((entry) => entry[0] === name);
  if (!row) throw new Error(`demo seed is missing ${name}`);
  return { name: row[0], emoji: row[1] };
}

/**
 * Demo-seed people with geography the generators do not yet persist.
 * Country is the floor; timezone upgrades Jo out of the US home city.
 */
const GOLDEN_USERS = [
  { personId: "p1", ...named("Dave"), country: "US", timezone: null },
  {
    personId: "p2",
    ...named("Mia"),
    country: "US",
    timezone: "America/Los_Angeles",
  },
  {
    personId: "p3",
    ...named("Jo"),
    country: "US",
    timezone: "America/New_York",
  },
  { personId: "p4", ...named("Rex"), country: "GB", timezone: null },
  { personId: "p5", ...named("Kai"), country: "GB", timezone: null },
  { personId: "p6", ...named("Zara"), country: "FR", timezone: null },
  { personId: "p7", ...named("Nova"), country: null, timezone: null },
] as const;

/** Dave at T−30m, quiet before ⇒ SF +1. Mia stays online. Jo drops off. */
const GOLDEN_EVENTS = [
  { personId: "p1", timestamp: ago(30) },
  { personId: "p2", timestamp: ago(90) },
  { personId: "p2", timestamp: ago(20) },
  { personId: "p3", timestamp: ago(90) },
  { personId: "p4", timestamp: ago(30) },
  { personId: "p6", timestamp: ago(90) },
  { personId: "p6", timestamp: ago(10) },
  { personId: "p7", timestamp: ago(15) },
];

const GOLDEN_TALLIES = {
  asOf: T.toISOString(),
  online: 5,
  cameOnline: 3,
  droppedOff: 1,
  unplaced: 1,
  unplacedOnline: 1,
  cities: [
    {
      city: "San Francisco",
      country: "US",
      timezone: "America/Los_Angeles",
      users: 2,
      online: 2,
      cameOnline: 1,
      droppedOff: 0,
      home: true,
    },
    {
      city: "London",
      country: "GB",
      timezone: "Europe/London",
      users: 2,
      online: 1,
      cameOnline: 1,
      droppedOff: 0,
      home: false,
    },
    {
      city: "New York",
      country: "US",
      timezone: "America/New_York",
      users: 1,
      online: 0,
      cameOnline: 0,
      droppedOff: 1,
      home: false,
    },
    {
      city: "Paris",
      country: "FR",
      timezone: "Europe/Paris",
      users: 1,
      online: 1,
      cameOnline: 0,
      droppedOff: 0,
      home: false,
    },
  ],
} satisfies Presence;

async function seedGolden() {
  await saveCompanyProfile(WS, { homeCity: DEMO_HOME_CITY });
  await db.insert(schema.users).values(
    GOLDEN_USERS.map((user) => ({
      personId: user.personId,
      name: user.name,
      emoji: user.emoji,
      country: user.country,
      timezone: user.timezone,
      workspaceId: WS,
    }))
  );
  await db.insert(schema.activity).values(
    GOLDEN_EVENTS.map((event, i) => ({
      personId: event.personId,
      timestamp: event.timestamp,
      eventName: "core",
      eventClass: "core" as const,
      externalId: `presence-golden-${i}`,
      workspaceId: WS,
    }))
  );
}

function personKeysIn(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => personKeysIn(item, `${path}[${i}]`));
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const here = Object.keys(record)
    .filter((key) => /person|userId|onlineBy/i.test(key))
    .map((key) => `${path}.${key}`);
  return [
    ...here,
    ...Object.entries(record).flatMap(([key, child]) =>
      personKeysIn(child, `${path}.${key}`)
    ),
  ];
}

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

describe("computePresence golden tallies (demo seed people)", () => {
  it("counts per city and the +1 past-hour delta", () => {
    const presence = computePresence({
      users: GOLDEN_USERS.map((user) => ({
        personId: user.personId,
        country: user.country,
        timezone: user.timezone,
      })),
      activity: GOLDEN_EVENTS,
      asOf: T,
      homeCity: DEMO_HOME_CITY,
    });

    expect(presence).toEqual(GOLDEN_TALLIES);
    expect(presence.cities.find((row) => row.city === "San Francisco")).toEqual(
      GOLDEN_TALLIES.cities[0]
    );
    expect(presence.cameOnline).toBe(3);
    expect(
      presence.cities.find((row) => row.city === "San Francisco")?.cameOnline
    ).toBe(1);
  });

  it("treats activity at T−30m with a quiet previous hour as +1", () => {
    const presence = computePresence({
      users: [{ personId: "p1", country: "US" }],
      activity: [{ personId: "p1", timestamp: ago(30) }],
      asOf: T,
      homeCity: DEMO_HOME_CITY,
    });
    expect(presence.online).toBe(1);
    expect(presence.cameOnline).toBe(1);
    expect(presence.droppedOff).toBe(0);
    expect(presence.cities[0]).toMatchObject({
      city: "San Francisco",
      online: 1,
      cameOnline: 1,
      droppedOff: 0,
      home: true,
    });
  });

  it("does not invent presence when there is no last data", () => {
    const presence = computePresence({
      users: GOLDEN_USERS.map((user) => ({
        personId: user.personId,
        country: user.country,
        timezone: user.timezone,
      })),
      activity: [],
      asOf: null,
      homeCity: DEMO_HOME_CITY,
    });
    expect(presence.asOf).toBeNull();
    expect(presence.online).toBe(0);
    expect(presence.cameOnline).toBe(0);
    expect(presence.droppedOff).toBe(0);
    expect(presence.unplacedOnline).toBe(0);
    expect(presence.cities.every((row) => row.online === 0)).toBe(true);
  });
});

describe("city ranking", () => {
  it("ranks by headcount with the home city pinned first", () => {
    const presence = computePresence({
      users: [
        { personId: "sf-1", country: "US", timezone: "America/Los_Angeles" },
        { personId: "lon-1", country: "GB" },
        { personId: "lon-2", country: "GB" },
        { personId: "lon-3", country: "GB" },
        { personId: "par-1", country: "FR" },
        { personId: "par-2", country: "FR" },
      ],
      activity: [],
      asOf: T,
      homeCity: DEMO_HOME_CITY,
    });
    expect(presence.cities.map((row) => row.city)).toEqual([
      "San Francisco",
      "London",
      "Paris",
    ]);
    expect(presence.cities[0]?.home).toBe(true);
    expect(presence.cities[0]?.users).toBe(1);
    expect(presence.cities[1]?.users).toBe(3);
    expect(presence.cities[2]?.users).toBe(2);
    expect(presence.cities.slice(1).every((row) => row.home === false)).toBe(
      true
    );
  });

  it("pins a configured home city even when nobody lives there", () => {
    const presence = computePresence({
      users: [
        { personId: "lon-1", country: "GB" },
        { personId: "lon-2", country: "GB" },
      ],
      activity: [],
      asOf: T,
      homeCity: DEMO_HOME_CITY,
    });
    expect(presence.cities[0]).toMatchObject({
      city: "San Francisco",
      timezone: "America/Los_Angeles",
      users: 0,
      online: 0,
      home: true,
    });
    expect(presence.cities[1]?.city).toBe("London");
    expect(presence.cities[1]?.users).toBe(2);
  });
});

describe("loadWorkspacePresence", () => {
  it("reads the demo-seed fixture from the activity table", async () => {
    await seedGolden();
    const presence = await loadWorkspacePresence(WS, { asOf: T });
    expect(presence).toEqual(GOLDEN_TALLIES);
  });

  it("uses last ingested activity as T when asOf is omitted", async () => {
    await seedGolden();
    const latest = await db
      .select({
        id: schema.activity.id,
        timestamp: schema.activity.timestamp,
      })
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, WS))
      .all();
    const last = latest.reduce((a, b) => (a.id > b.id ? a : b));
    const presence = await loadWorkspacePresence(WS);
    expect(presence.asOf).toBe(last.timestamp.toISOString());
    expect(presence.asOf).toBe(GOLDEN_EVENTS[GOLDEN_EVENTS.length - 1]?.timestamp.toISOString());
  });
});

describe("GET /api/v1/overview and MCP get_overview share presence", () => {
  async function callOverview() {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");
    const response = await getOverview(
      new NextRequest(`http://localhost:3000/api/v1/overview?workspace=${WS}`, {
        headers: { authorization: `Bearer ${ADMIN}` },
      })
    );
    expect(response.status).toBe(200);
    return OverviewResponseSchema.parse(await response.json());
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
      presence: Presence;
    };
  }

  it("returns the same city tallies from one calculator", async () => {
    await seedGolden();
    const expected = await loadWorkspacePresence(WS);
    const rest = await callOverview();
    const mcp = await callMcpOverview();
    expect(rest.presence).toEqual(expected);
    expect(mcp.presence).toEqual(expected);
  });
});

describe("presence privacy contract", () => {
  it("lists no individual's online state on the overview contract", () => {
    expect(Object.keys(PresenceCitySchema.shape).sort()).toEqual([
      "cameOnline",
      "city",
      "country",
      "droppedOff",
      "home",
      "online",
      "timezone",
      "users",
    ]);
    expect(Object.keys(PresenceSchema.shape).sort()).toEqual([
      "asOf",
      "cameOnline",
      "cities",
      "droppedOff",
      "online",
      "unplaced",
      "unplacedOnline",
    ]);
    expect(PresenceSchema.shape).not.toHaveProperty("people");
    expect(PresenceSchema.shape).not.toHaveProperty("personId");
    expect(PresenceCitySchema.shape).not.toHaveProperty("personId");
    expect(PresenceCitySchema.shape).not.toHaveProperty("personIds");
    expect(OverviewResponseSchema.shape.presence).toBe(PresenceSchema);
  });

  it("serialized presence never names a person", () => {
    const presence = computePresence({
      users: GOLDEN_USERS.map((user) => ({
        personId: user.personId,
        country: user.country,
        timezone: user.timezone,
      })),
      activity: GOLDEN_EVENTS,
      asOf: T,
      homeCity: DEMO_HOME_CITY,
    });
    const json = JSON.parse(JSON.stringify(presence)) as unknown;
    expect(personKeysIn(json)).toEqual([]);
    const blob = JSON.stringify(presence);
    for (const user of GOLDEN_USERS) {
      expect(blob).not.toContain(user.personId);
      expect(blob).not.toContain(user.name);
    }
  });

  it("no response schema lists a per-person online flag", () => {
    const src = readFileSync(resolve(root, "src/core/contracts.ts"), "utf8");
    expect(src).not.toMatch(/online:\s*z\.boolean/);
    expect(src).not.toMatch(/isOnline/);
    expect(src).not.toMatch(/personIds:\s*z\.array/);

    const presenceSrc = readFileSync(resolve(root, "src/core/presence.ts"), "utf8");
    expect(presenceSrc).toMatch(/Summaries only/);
    expect(presenceSrc).not.toMatch(/return\s+\{[^}]*personId/s);

    const offenders: string[] = [];
    for (const file of walkTsFiles(resolve(root, "src"))) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const text = readFileSync(file, "utf8");
      if (
        /onlineByPerson|isOnline:\s*(true|false|boolean)|personOnline/.test(text)
      ) {
        offenders.push(relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("presence window", () => {
  it("asks the previous hour as T minus one HOUR_MS", () => {
    expect(HOUR_MS).toBe(3_600_000);
    const stillPrev = computePresence({
      users: [{ personId: "edge", country: "US" }],
      activity: [{ personId: "edge", timestamp: new Date(T.getTime() - HOUR_MS) }],
      asOf: T,
    });
    expect(stillPrev.online).toBe(0);
    expect(stillPrev.droppedOff).toBe(1);

    const justNow = computePresence({
      users: [{ personId: "edge", country: "US" }],
      activity: [{ personId: "edge", timestamp: T }],
      asOf: T,
    });
    expect(justNow.online).toBe(1);
    expect(justNow.cameOnline).toBe(1);
  });
});
