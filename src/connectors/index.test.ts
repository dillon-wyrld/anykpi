import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
import {
  getConnector,
  listConnectors,
  registry,
  sync,
} from "./index";
import {
  fixtureDir,
  installConnectorFetch,
  loadFixtureSuite,
} from "./testing";

const originalPosthogKey = process.env.POSTHOG_API_KEY;
const originalPosthogProject = process.env.POSTHOG_PROJECT_ID;
const originalPosthogHost = process.env.POSTHOG_HOST;

afterEach(() => {
  restoreEnv("POSTHOG_API_KEY", originalPosthogKey);
  restoreEnv("POSTHOG_PROJECT_ID", originalPosthogProject);
  restoreEnv("POSTHOG_HOST", originalPosthogHost);
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe("connector registry", () => {
  it("lists the shipped connectors keyed by source", () => {
    expect(Object.keys(registry).sort()).toEqual([
      "amplitude",
      "ics",
      "mixpanel",
      "posthog",
      "revenuecat",
      "stripe",
    ]);
    expect(listConnectors().map((c) => c.source).sort()).toEqual([
      "amplitude",
      "ics",
      "mixpanel",
      "posthog",
      "revenuecat",
      "stripe",
    ]);
    expect(registry.posthog.name).toBe("PostHog");
    expect(registry.mixpanel.name).toBe("Mixpanel");
    expect(registry.amplitude.name).toBe("Amplitude");
    expect(registry.stripe.name).toBe("Stripe");
    expect(registry.revenuecat.name).toBe("RevenueCat");
    expect(registry.ics.name).toBe("Calendar");
    expect(getConnector("posthog")).toBe(registry.posthog);
    expect(getConnector("stripe")).toBe(registry.stripe);
    expect(getConnector("revenuecat")).toBe(registry.revenuecat);
    expect(getConnector("ics")).toBe(registry.ics);
  });

  it("rejects unknown sources", async () => {
    await expect(sync("not-a-source")).rejects.toThrow(/Unknown connector source/);
  });

  it("states cursor and health contracts next to the interface", () => {
    const src = readFileSync(resolve(__dirname, "index.ts"), "utf8");
    expect(src).toMatch(/export interface Connector/);
    expect(src).toMatch(/Cursor contract/);
    expect(src).toMatch(/Health contract/);
    expect(src).toMatch(/health === "ok"/);
    expect(src).toMatch(/degraded/);
    expect(src).toMatch(/Config contract/);
    expect(src).toMatch(/opts\.config/);
    expect(src).toMatch(/deprecated/);
  });
});

describe('sync("posthog")', () => {
  it("runs through the registry against recorded fixtures", async () => {
    process.env.POSTHOG_API_KEY = "phx_test";
    process.env.POSTHOG_PROJECT_ID = "proj_fixture";
    process.env.POSTHOG_HOST = "https://app.posthog.com";

    const suite = loadFixtureSuite(fixtureDir("posthog"));
    const harness = installConnectorFetch({
      fixtures: suite,
      recordDir: fixtureDir("posthog"),
      source: "posthog",
    });

    try {
      const result = await sync("posthog");

      expect(result.health).toBe("ok");
      expect(result.nextCursor).toBeNull();
      expect(result.rowsSynced).toBe(3);

      const users = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.personId, "person_fixture-ada"))
        .all();
      expect(users).toHaveLength(1);
      expect(users[0]?.name).toBe("Ada");

      const events = await db
        .select()
        .from(schema.activity)
        .where(eq(schema.activity.personId, "person_fixture-ada"))
        .all();
      expect(events.map((e) => e.eventName).sort()).toEqual([
        "search_performed",
        "song_played",
      ]);

      expect(harness.calls).toHaveLength(2);
      expect(harness.calls[0]?.url).toContain("/persons/");
      expect(harness.calls[1]?.url).toContain("/events/");
    } finally {
      harness.restore();
    }
  });
});
