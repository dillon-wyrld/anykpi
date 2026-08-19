/**
 * Per-source credential store. Config is encrypted at rest with ANYKPI_SECRET.
 * Callers must never log credentials or ciphertext.
 */

import { and, eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { decryptJson, encryptJson, instanceSecret } from "./source-crypto";

export type SourceConfig = Record<string, string>;

export type SaveSourceResult = {
  rotated: boolean;
};

export function hasInstanceSecret(): boolean {
  return Boolean(instanceSecret());
}

function assertNonEmptyConfig(config: SourceConfig): void {
  const keys = Object.keys(config);
  if (keys.length === 0) {
    throw new Error("credentials required");
  }
  for (const key of keys) {
    if (config[key].length === 0) {
      throw new Error("credentials required");
    }
  }
}

export async function saveSourceConfig(
  workspaceId: string,
  source: string,
  config: SourceConfig
): Promise<SaveSourceResult> {
  assertNonEmptyConfig(config);
  const existing = await db
    .select({ id: schema.sources.id })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.workspaceId, workspaceId),
        eq(schema.sources.source, source)
      )
    )
    .get();

  const now = new Date();
  const ciphertext = encryptJson(config);

  await db
    .insert(schema.sources)
    .values({
      workspaceId,
      source,
      config: ciphertext,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.sources.workspaceId, schema.sources.source],
      set: {
        config: ciphertext,
        updatedAt: now,
      },
    });

  return { rotated: Boolean(existing) };
}

/**
 * Decrypt stored config for a workspace + source.
 * Returns null when no row exists or the instance key cannot open it.
 */
export async function loadSourceConfig(
  workspaceId: string,
  source: string
): Promise<SourceConfig | null> {
  if (!hasInstanceSecret()) return null;

  const row = await db
    .select({ config: schema.sources.config })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.workspaceId, workspaceId),
        eq(schema.sources.source, source)
      )
    )
    .get();

  if (!row) return null;

  try {
    const parsed = decryptJson<SourceConfig>(row.config);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

const HMAC_KEYS = ["hmacSecret", "webhookSecret", "secretKey"] as const;

/** HMAC secret for webhook-in. Never log the return value. */
export function webhookSecretFromConfig(
  config: SourceConfig | null
): string | null {
  if (!config) return null;
  for (const key of HMAC_KEYS) {
    const value = config[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

/** Raw stored bytes for a source row. Used by tests to assert ciphertext at rest. */
export async function loadSourceCiphertext(
  workspaceId: string,
  source: string
): Promise<string | null> {
  const row = await db
    .select({ config: schema.sources.config })
    .from(schema.sources)
    .where(
      and(
        eq(schema.sources.workspaceId, workspaceId),
        eq(schema.sources.source, source)
      )
    )
    .get();
  return row?.config ?? null;
}
