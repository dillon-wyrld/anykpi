import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { GET as getConfig, PATCH as patchConfig } from "@/app/api/v1/config/route";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { SESSION_COOKIE_NAME, signSession } from "@/core/session";
import {
  celebratedDaysConfigKey,
  claimCelebration,
  loadShownCities,
  saveShownCities,
  shownCitiesConfigKey,
} from "@/core/daytrack-prefs";

const A = "cities-a";
const B = "cities-b";
const ADMIN = "cities-admin";
const originalKey = process.env.ANYKPI_API_KEY;

afterEach(async () => {
  if (originalKey === undefined) delete process.env.ANYKPI_API_KEY;
  else process.env.ANYKPI_API_KEY = originalKey;
  vi.unstubAllEnvs();
  await db.delete(schema.config).where(eq(schema.config.workspaceId, A));
  await db.delete(schema.config).where(eq(schema.config.workspaceId, B));
});

function asAdmin(url: string, method: string, body?: unknown) {
  process.env.ANYKPI_API_KEY = ADMIN;
  vi.stubEnv("NODE_ENV", "test");
  return new NextRequest(url, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("shown-city prefs survive a restart and stay per-workspace", () => {
  it("reloads the saved set from config and isolates workspaces", async () => {
    expect(shownCitiesConfigKey(A)).toBe(`shown_cities:${A}`);
    expect(await loadShownCities(A)).toBeNull();

    await saveShownCities(A, [
      "US:San Francisco:America/Los_Angeles",
      "JP:Tokyo:Asia/Tokyo",
    ]);
    await saveShownCities(B, ["GB:London:Europe/London"]);

    const afterRestartA = await loadShownCities(A);
    const afterRestartB = await loadShownCities(B);
    expect(afterRestartA).toEqual([
      "US:San Francisco:America/Los_Angeles",
      "JP:Tokyo:Asia/Tokyo",
    ]);
    expect(afterRestartB).toEqual(["GB:London:Europe/London"]);

    const viaApi = await getConfig(
      asAdmin(`http://localhost:3000/api/v1/config?workspace=${A}`, "GET")
    );
    expect(viaApi.status).toBe(200);
    const body = (await viaApi.json()) as { shownCities: string[] | null };
    expect(body.shownCities).toEqual(afterRestartA);
  });

  it("a fresh workspace with no saved prefs returns null so ranking fills in", async () => {
    expect(await loadShownCities(A)).toBeNull();
    const response = await getConfig(
      asAdmin(`http://localhost:3000/api/v1/config?workspace=${A}`, "GET")
    );
    const body = (await response.json()) as { shownCities: string[] | null };
    expect(body.shownCities).toBeNull();
  });
});

describe("celebration claim is one-shot", () => {
  it("claimCelebration returns true once per key", async () => {
    const key = `${A}:company_day:365`;
    expect(celebratedDaysConfigKey(A)).toBe(`celebrated_days:${A}`);
    expect(await claimCelebration(A, key)).toBe(true);
    expect(await claimCelebration(A, key)).toBe(false);
    expect(await claimCelebration(B, key)).toBe(true);
  });
});

describe("PATCH /api/v1/config shownCities", () => {
  it("a browser session can save display prefs; anonymous demo cannot", async () => {
    process.env.ANYKPI_API_KEY = ADMIN;
    process.env.ANYKPI_SECRET = "cities-secret";
    vi.stubEnv("NODE_ENV", "test");

    const cookie = `${SESSION_COOKIE_NAME}=${signSession({
      actor: "env",
      workspace: A,
      workspaces: [A],
      canChooseWorkspace: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}`;

    const saved = await patchConfig(
      new NextRequest("http://localhost:3000/api/v1/config", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({
          workspaceId: A,
          shownCities: ["US:San Francisco:America/Los_Angeles"],
        }),
      })
    );
    expect(saved.status).toBe(200);
    expect(await loadShownCities(A)).toEqual([
      "US:San Francisco:America/Los_Angeles",
    ]);

    const denied = await patchConfig(
      new NextRequest("http://localhost:3000/api/v1/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "demo",
          shownCities: ["US:San Francisco:America/Los_Angeles"],
        }),
      })
    );
    expect(denied.status).toBe(401);
  });
});
