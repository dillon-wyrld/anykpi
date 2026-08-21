/**
 * Day-of-YourCo display prefs. Shown-city set and one-shot celebration
 * claims live in the existing config table — no new migration.
 *
 * Keys: `shown_cities:<workspace>`, `celebrated_days:<workspace>`.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertConfig } from "@/core/upsert";
import { markCelebrated } from "@/core/daytrack-celebrate";

export { markCelebrated, shouldFireCelebration } from "@/core/daytrack-celebrate";

const SHOWN_CITIES_MAX = 32;
const CELEBRATED_KEYS_MAX = 64;
const KEY_MAX = 200;

export function shownCitiesConfigKey(workspaceId: string): string {
  return `shown_cities:${workspaceId}`;
}

export function celebratedDaysConfigKey(workspaceId: string): string {
  return `celebrated_days:${workspaceId}`;
}

export function parseStringList(raw: string | null | undefined): string[] | null {
  if (raw == null || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const keys = parsed.filter((row): row is string => typeof row === "string");
    const cleaned = keys.map((row) => row.trim()).filter((row) => row.length > 0);
    return cleaned.length > 0 ? cleaned : [];
  } catch {
    return null;
  }
}

export function serializeStringList(keys: string[]): string {
  return JSON.stringify(keys);
}

export function normalizePrefKeys(
  keys: string[],
  maxItems: number
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of keys) {
    const key = raw.trim();
    if (!key || key.length > KEY_MAX || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= maxItems) break;
  }
  return out;
}

export async function loadShownCities(
  workspaceId: string
): Promise<string[] | null> {
  const row = await db
    .select()
    .from(schema.config)
    .where(
      and(
        eq(schema.config.workspaceId, workspaceId),
        eq(schema.config.key, shownCitiesConfigKey(workspaceId))
      )
    )
    .get();
  return parseStringList(row?.value);
}

export async function saveShownCities(
  workspaceId: string,
  keys: string[] | null
): Promise<string[] | null> {
  if (keys === null) {
    await db
      .delete(schema.config)
      .where(
        and(
          eq(schema.config.workspaceId, workspaceId),
          eq(schema.config.key, shownCitiesConfigKey(workspaceId))
        )
      );
    return null;
  }

  const normalized = normalizePrefKeys(keys, SHOWN_CITIES_MAX);
  await upsertConfig({
    key: shownCitiesConfigKey(workspaceId),
    value: serializeStringList(normalized),
    workspaceId,
  });
  return normalized;
}

export async function loadCelebratedDays(workspaceId: string): Promise<string[]> {
  const row = await db
    .select()
    .from(schema.config)
    .where(
      and(
        eq(schema.config.workspaceId, workspaceId),
        eq(schema.config.key, celebratedDaysConfigKey(workspaceId))
      )
    )
    .get();
  return parseStringList(row?.value) ?? [];
}

export async function saveCelebratedDays(
  workspaceId: string,
  keys: string[]
): Promise<string[]> {
  const normalized = normalizePrefKeys(keys, CELEBRATED_KEYS_MAX);
  await upsertConfig({
    key: celebratedDaysConfigKey(workspaceId),
    value: serializeStringList(normalized),
    workspaceId,
  });
  return normalized;
}

/**
 * Record that this milestone has been celebrated. Returns true only for
 * the first claim so the motion cannot fire twice.
 */
export async function claimCelebration(
  workspaceId: string,
  milestoneKey: string
): Promise<boolean> {
  const key = milestoneKey.trim();
  if (!key) return false;
  const current = await loadCelebratedDays(workspaceId);
  if (current.includes(key)) return false;
  await saveCelebratedDays(workspaceId, markCelebrated(current, key));
  return true;
}
