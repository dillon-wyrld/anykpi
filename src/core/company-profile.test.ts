import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { GET as getConfig, PATCH as patchConfig } from "@/app/api/v1/config/route";
import {
  companyNameConfigKey,
  foundedAtConfigKey,
  homeCityConfigKey,
} from "@/core/milestones";
import {
  DEFAULT_COMPANY_NAME,
  FOUNDED_AT_FUTURE_ERROR,
  formatCompanyDayLabel,
} from "@/core/company-day";
import {
  CompanyProfileError,
  loadCompanyProfile,
  saveCompanyProfile,
} from "@/core/company-profile";
import { db } from "@/core/db";
import * as schema from "@/core/schema";

const A = "profile-a";
const B = "profile-b";
const ADMIN = "profile-admin";
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

describe("company profile copy", () => {
  it("setting the name changes Day of <name> everywhere it renders", async () => {
    expect(formatCompanyDayLabel(undefined)).toBe(`Day of ${DEFAULT_COMPANY_NAME}`);
    expect(formatCompanyDayLabel("YourCo")).toBe("Day of YourCo");

    const first = await saveCompanyProfile(A, { companyName: "Acme" });
    expect(first.dayLabel).toBe("Day of Acme");
    expect(first.companyName).toBe("Acme");

    const loaded = await loadCompanyProfile(A);
    expect(loaded.dayLabel).toBe("Day of Acme");
    expect(formatCompanyDayLabel(loaded.companyName)).toBe("Day of Acme");

    const renamed = await saveCompanyProfile(A, { companyName: "Northwind" });
    expect(renamed.dayLabel).toBe("Day of Northwind");
    expect((await loadCompanyProfile(A)).dayLabel).toBe("Day of Northwind");

    const viaApi = await patchConfig(
      asAdmin("http://localhost:3000/api/v1/config", "PATCH", {
        workspaceId: A,
        companyName: "Harbor",
      })
    );
    expect(viaApi.status).toBe(200);
    const body = (await viaApi.json()) as { dayLabel: string; companyName: string };
    expect(body.companyName).toBe("Harbor");
    expect(body.dayLabel).toBe("Day of Harbor");
    expect(formatCompanyDayLabel(body.companyName)).toBe(body.dayLabel);

    const root = resolve(__dirname, "../..");
    const connect = readFileSync(resolve(root, "src/app/connect/page.tsx"), "utf8");
    const calendar = readFileSync(resolve(root, "src/components/Calendar.tsx"), "utf8");
    expect(connect).toContain("formatCompanyDayLabel");
    expect(calendar).toContain("dayLabel");
    expect(calendar).toContain("formatCompanyDayLabel");
  });
});

describe("company profile isolation", () => {
  it("two workspaces hold independent profiles", async () => {
    await saveCompanyProfile(A, {
      companyName: "Alpha",
      foundedAt: "2020-01-15",
      homeCity: { timezone: "America/Los_Angeles", label: "San Francisco" },
    });
    await saveCompanyProfile(B, {
      companyName: "Beta",
      foundedAt: "2018-06-01",
      homeCity: { timezone: "Europe/London", label: "London" },
    });

    const alpha = await loadCompanyProfile(A);
    const beta = await loadCompanyProfile(B);

    expect(alpha.companyName).toBe("Alpha");
    expect(alpha.dayLabel).toBe("Day of Alpha");
    expect(alpha.foundedAt).toBe("2020-01-15T00:00:00.000Z");
    expect(alpha.homeCity).toEqual({
      timezone: "America/Los_Angeles",
      label: "San Francisco",
    });

    expect(beta.companyName).toBe("Beta");
    expect(beta.dayLabel).toBe("Day of Beta");
    expect(beta.foundedAt).toBe("2018-06-01T00:00:00.000Z");
    expect(beta.homeCity).toEqual({
      timezone: "Europe/London",
      label: "London",
    });

    await saveCompanyProfile(A, { companyName: "Alpha Two" });
    expect((await loadCompanyProfile(A)).dayLabel).toBe("Day of Alpha Two");
    expect((await loadCompanyProfile(B)).dayLabel).toBe("Day of Beta");

    const alphaName = await db
      .select()
      .from(schema.config)
      .where(
        and(
          eq(schema.config.workspaceId, A),
          eq(schema.config.key, companyNameConfigKey(A))
        )
      )
      .get();
    const betaName = await db
      .select()
      .from(schema.config)
      .where(
        and(
          eq(schema.config.workspaceId, B),
          eq(schema.config.key, companyNameConfigKey(B))
        )
      )
      .get();
    expect(alphaName?.value).toBe("Alpha Two");
    expect(betaName?.value).toBe("Beta");
    expect(companyNameConfigKey(A)).toBe(`company_name:${A}`);
    expect(foundedAtConfigKey(A)).toBe(`founded_at:${A}`);
    expect(homeCityConfigKey(A)).toBe(`home_city:${A}`);
  });
});

describe("founded date validation", () => {
  it("rejects a future founded date with a clear message", async () => {
    const future = "2099-01-01";
    await expect(
      saveCompanyProfile(A, { foundedAt: future })
    ).rejects.toBeInstanceOf(CompanyProfileError);
    await expect(saveCompanyProfile(A, { foundedAt: future })).rejects.toThrow(
      FOUNDED_AT_FUTURE_ERROR
    );

    const response = await patchConfig(
      asAdmin("http://localhost:3000/api/v1/config", "PATCH", {
        workspaceId: A,
        foundedAt: future,
      })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(FOUNDED_AT_FUTURE_ERROR);
  });

  it("accepts today and a past founded date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const saved = await saveCompanyProfile(A, { foundedAt: "2019-03-04" });
    expect(saved.foundedAt).toBe("2019-03-04T00:00:00.000Z");

    const todaySaved = await saveCompanyProfile(A, { foundedAt: today });
    expect(todaySaved.foundedAt).toBe(`${today}T00:00:00.000Z`);
  });
});

describe("GET /api/v1/config", () => {
  it("returns the default YourCo profile when nothing is stored", async () => {
    const response = await getConfig(
      asAdmin(`http://localhost:3000/api/v1/config?workspace=${A}`, "GET")
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      companyName: string;
      dayLabel: string;
      foundedAt: string | null;
      homeCity: null;
    };
    expect(body.companyName).toBe(DEFAULT_COMPANY_NAME);
    expect(body.dayLabel).toBe("Day of YourCo");
    expect(body.foundedAt).toBeNull();
    expect(body.homeCity).toBeNull();
  });
});
