/**
 * Per-workspace setup-flow rows in the existing `config` table.
 * No schema migration. Server-only (database imports).
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { SHIPPED_SOURCE_IDS } from "@/core/source-gallery";
import {
  demoBannerConfigKey,
  parseSetupFlowStatus,
  setupFlowConfigKey,
  type SetupFlowStatus,
} from "@/core/setup-flow";
import {
  companyNameConfigKey,
  foundedAtConfigKey,
  homeCityConfigKey,
} from "@/core/milestones";
import { DEFAULT_COMPANY_NAME } from "@/core/company-day";
import { upsertConfig } from "@/core/upsert";

const SHIPPED = new Set<string>(SHIPPED_SOURCE_IDS);

export async function loadSetupFlowStatus(
  workspaceId: string
): Promise<SetupFlowStatus> {
  const row = await db
    .select()
    .from(schema.config)
    .where(
      and(
        eq(schema.config.workspaceId, workspaceId),
        eq(schema.config.key, setupFlowConfigKey(workspaceId))
      )
    )
    .get();
  return parseSetupFlowStatus(row?.value);
}

export async function saveSetupFlowStatus(
  workspaceId: string,
  status: "complete" | "skipped"
): Promise<void> {
  await upsertConfig({
    key: setupFlowConfigKey(workspaceId),
    value: status,
    workspaceId,
  });
}

export async function loadBannerDismissed(workspaceId: string): Promise<boolean> {
  const row = await db
    .select()
    .from(schema.config)
    .where(
      and(
        eq(schema.config.workspaceId, workspaceId),
        eq(schema.config.key, demoBannerConfigKey(workspaceId))
      )
    )
    .get();
  return row?.value === "1";
}

export async function saveBannerDismissed(workspaceId: string): Promise<void> {
  await upsertConfig({
    key: demoBannerConfigKey(workspaceId),
    value: "1",
    workspaceId,
  });
}

export async function workspaceHasProfile(workspaceId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.workspaceId, workspaceId))
    .all();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const name = byKey.get(companyNameConfigKey(workspaceId))?.trim();
  const founded = byKey.get(foundedAtConfigKey(workspaceId));
  const city = byKey.get(homeCityConfigKey(workspaceId));
  if (name && name !== DEFAULT_COMPANY_NAME) return true;
  if (founded) return true;
  if (city) return true;
  return false;
}

export async function workspaceConnectedSources(
  workspaceId: string
): Promise<string[]> {
  const rows = await db
    .select({ source: schema.sources.source })
    .from(schema.sources)
    .where(eq(schema.sources.workspaceId, workspaceId))
    .all();
  return rows.map((row) => row.source).filter((source) => SHIPPED.has(source));
}
