/**
 * Per-workspace company profile: name, founded date, home city.
 * Stored in the existing `config` table (ANY-48/39 isolate by workspace).
 */

import { and, eq } from "drizzle-orm";
import {
  companyNameConfigKey,
  foundedAtConfigKey,
  homeCityConfigKey,
} from "@/core/milestones";
import {
  COMPANY_NAME_EMPTY_ERROR,
  COMPANY_NAME_MAX,
  DEFAULT_COMPANY_NAME,
  FOUNDED_AT_FUTURE_ERROR,
  FOUNDED_AT_INVALID_ERROR,
  HOME_CITY_LABEL_ERROR,
  HOME_CITY_LABEL_MAX,
  HOME_CITY_TIMEZONE_ERROR,
  formatCompanyDayLabel,
  foundedAtIsFuture,
  isIanaTimeZone,
  parseFoundedAt,
  parseHomeCity,
  serializeHomeCity,
  type HomeCity,
} from "@/core/company-day";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertConfig } from "@/core/upsert";
import {
  loadCelebratedDays,
  loadShownCities,
  saveCelebratedDays,
  saveShownCities,
} from "@/core/daytrack-prefs";

export {
  DEFAULT_COMPANY_NAME,
  FOUNDED_AT_FUTURE_ERROR,
  FOUNDED_AT_INVALID_ERROR,
  formatCompanyDayLabel,
  type HomeCity,
} from "@/core/company-day";

export class CompanyProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyProfileError";
  }
}

export type CompanyProfile = {
  workspaceId: string;
  companyName: string;
  foundedAt: string | null;
  homeCity: HomeCity | null;
  dayLabel: string;
  shownCities: string[] | null;
  celebratedMilestoneKeys: string[];
};

export type CompanyProfilePatch = {
  companyName?: string;
  foundedAt?: string | null;
  homeCity?: HomeCity | null;
  shownCities?: string[] | null;
  celebratedMilestoneKeys?: string[];
};

function normalizeCompanyName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new CompanyProfileError(COMPANY_NAME_EMPTY_ERROR);
  }
  if (trimmed.length > COMPANY_NAME_MAX) {
    throw new CompanyProfileError(
      `Company name must be ${COMPANY_NAME_MAX} characters or fewer`
    );
  }
  return trimmed;
}

function normalizeFoundedAt(value: string): string {
  const parsed = parseFoundedAt(value);
  if (!parsed) {
    throw new CompanyProfileError(FOUNDED_AT_INVALID_ERROR);
  }
  if (foundedAtIsFuture(parsed)) {
    throw new CompanyProfileError(FOUNDED_AT_FUTURE_ERROR);
  }
  return parsed.toISOString();
}

function normalizeHomeCity(city: HomeCity): HomeCity {
  const timezone = city.timezone.trim();
  const label = city.label.trim();
  if (!label) {
    throw new CompanyProfileError(HOME_CITY_LABEL_ERROR);
  }
  if (label.length > HOME_CITY_LABEL_MAX) {
    throw new CompanyProfileError(
      `Home city label must be ${HOME_CITY_LABEL_MAX} characters or fewer`
    );
  }
  if (!timezone || !isIanaTimeZone(timezone)) {
    throw new CompanyProfileError(HOME_CITY_TIMEZONE_ERROR);
  }
  return { timezone, label };
}

function toProfile(
  workspaceId: string,
  companyName: string | null,
  foundedAt: string | null,
  homeCity: HomeCity | null,
  shownCities: string[] | null,
  celebratedMilestoneKeys: string[]
): CompanyProfile {
  const name = companyName?.trim() || DEFAULT_COMPANY_NAME;
  return {
    workspaceId,
    companyName: name,
    foundedAt,
    homeCity,
    dayLabel: formatCompanyDayLabel(name),
    shownCities,
    celebratedMilestoneKeys,
  };
}

export async function loadCompanyProfile(
  workspaceId: string
): Promise<CompanyProfile> {
  const rows = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.workspaceId, workspaceId))
    .all();

  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const name = byKey.get(companyNameConfigKey(workspaceId)) ?? null;
  const foundedRaw = byKey.get(foundedAtConfigKey(workspaceId)) ?? null;
  const foundedAt = foundedRaw && parseFoundedAt(foundedRaw)
    ? new Date(foundedRaw).toISOString()
    : null;

  return toProfile(
    workspaceId,
    name,
    foundedAt,
    parseHomeCity(byKey.get(homeCityConfigKey(workspaceId))),
    await loadShownCities(workspaceId),
    await loadCelebratedDays(workspaceId)
  );
}

export async function saveCompanyProfile(
  workspaceId: string,
  patch: CompanyProfilePatch
): Promise<CompanyProfile> {
  if (patch.companyName !== undefined) {
    await upsertConfig({
      key: companyNameConfigKey(workspaceId),
      value: normalizeCompanyName(patch.companyName),
      workspaceId,
    });
  }

  if (patch.foundedAt !== undefined) {
    if (patch.foundedAt === null || patch.foundedAt.trim() === "") {
      await db
        .delete(schema.config)
        .where(
          and(
            eq(schema.config.workspaceId, workspaceId),
            eq(schema.config.key, foundedAtConfigKey(workspaceId))
          )
        );
    } else {
      await upsertConfig({
        key: foundedAtConfigKey(workspaceId),
        value: normalizeFoundedAt(patch.foundedAt),
        workspaceId,
      });
    }
  }

  if (patch.homeCity !== undefined) {
    if (patch.homeCity === null) {
      await db
        .delete(schema.config)
        .where(
          and(
            eq(schema.config.workspaceId, workspaceId),
            eq(schema.config.key, homeCityConfigKey(workspaceId))
          )
        );
    } else {
      await upsertConfig({
        key: homeCityConfigKey(workspaceId),
        value: serializeHomeCity(normalizeHomeCity(patch.homeCity)),
        workspaceId,
      });
    }
  }

  if (patch.shownCities !== undefined) {
    await saveShownCities(workspaceId, patch.shownCities);
  }

  if (patch.celebratedMilestoneKeys !== undefined) {
    await saveCelebratedDays(workspaceId, patch.celebratedMilestoneKeys);
  }

  return loadCompanyProfile(workspaceId);
}
