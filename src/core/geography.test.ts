import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { POST as postIdentify } from "@/app/api/ingest/identify/route";
import { db } from "./db";
import * as schema from "./schema";
import {
  geographyFromProperties,
  placeUsers,
  resolveGeography,
} from "./geography";
import Anykpi, { IDENTIFY_PATH } from "../../packages/sdk/src/index";
import { browserSnippet } from "../../packages/sdk/src/snippet";

const WS = "geo-users";
const ADMIN = "geo-identify-admin";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await db.delete(schema.users).where(eq(schema.users.workspaceId, WS));
});

describe("resolveGeography", () => {
  it("prefers an explicit timezone over device and country fallback", () => {
    expect(
      resolveGeography({
        country: "US",
        timezone: "America/Chicago",
        deviceTimezone: "America/New_York",
      })
    ).toEqual({ country: "US", timezone: "America/Chicago" });
  });

  it("uses the device timezone when no explicit zone is set", () => {
    expect(
      resolveGeography({
        country: "FR",
        deviceTimezone: "Europe/Paris",
      })
    ).toEqual({ country: "FR", timezone: "Europe/Paris" });
  });

  it("falls back to a country-derived IANA zone and never invents one", () => {
    expect(resolveGeography({ country: "JP" })).toEqual({
      country: "JP",
      timezone: "Asia/Tokyo",
    });
    expect(resolveGeography({ country: "ZZ" })).toEqual({
      country: "ZZ",
      timezone: null,
    });
    expect(resolveGeography({})).toEqual({ country: null, timezone: null });
  });

  it("maps source geoip keys the same way as an explicit pair", () => {
    expect(
      geographyFromProperties({
        $geoip_country_code: "US",
        $geoip_time_zone: "America/Los_Angeles",
      })
    ).toEqual({ country: "US", timezone: "America/Los_Angeles" });
  });
});

describe("placeUsers", () => {
  it("counts unplaced users instead of dropping them", () => {
    const report = placeUsers([
      { personId: "a", country: "US", timezone: "America/Los_Angeles" },
      { personId: "b", country: "GB", timezone: "Europe/London" },
      { personId: "c" },
      { personId: "d", country: "ZZ" },
    ]);
    expect(report.total).toBe(4);
    expect(report.placed).toBe(2);
    expect(report.unplaced).toBe(2);
    expect(report.placed + report.unplaced).toBe(report.total);
    expect(report.cities.map((row) => row.city).sort()).toEqual([
      "London",
      "San Francisco",
    ]);
  });
});

describe("POST /api/ingest/identify geography", () => {
  it("records the device timezone sent by the snippet", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const html = browserSnippet({
      endpoint: "http://localhost:3000",
      workspaceId: WS,
      apiKey: ADMIN,
      userId: "snippet-tz",
      properties: { name: "Snippet user", platform: "web" },
    });
    expect(html).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone");
    expect(html).toContain("deviceTimezone");

    const res = await postIdentify(
      new NextRequest("http://localhost:3000/api/ingest/identify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${ADMIN}`,
        },
        body: JSON.stringify({
          userId: "snippet-tz",
          workspaceId: WS,
          properties: {
            name: "Snippet user",
            platform: "web",
            deviceTimezone: "America/Denver",
          },
        }),
      })
    );
    expect(res.status).toBe(200);

    const row = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.personId, "person_snippet-tz"))
      .get();
    expect(row?.timezone).toBe("America/Denver");
    expect(row?.workspaceId).toBe(WS);
  });

  it("lets the SDK attach the runtime device timezone on identify", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    vi.stubEnv("NODE_ENV", "test");

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const request = new NextRequest(url, {
        method: init?.method ?? "POST",
        headers: init?.headers,
        body: init?.body ?? undefined,
      });
      if (url.includes(IDENTIFY_PATH)) {
        const res = await postIdentify(request);
        return new Response(await res.text(), { status: res.status });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const client = new Anykpi({
        endpoint: "http://localhost:3000",
        workspaceId: WS,
        apiKey: ADMIN,
      });
      await client.identify({
        userId: "sdk-tz",
        properties: { name: "SDK tz", platform: "web" },
      });

      const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
        properties: { deviceTimezone?: string };
      };
      expect(body.properties.deviceTimezone).toMatch(/\S/);

      const row = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.personId, "person_sdk-tz"))
        .get();
      expect(row?.timezone).toBe(body.properties.deviceTimezone);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
