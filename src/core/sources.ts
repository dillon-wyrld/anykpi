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

function sourceWhere(workspaceId: string, source: string) {
  return and(
    eq(schema.sources.workspaceId, workspaceId),
    eq(schema.sources.source, source)
  );
}

function syncWhere(workspaceId: string, source: string) {
  return and(
    eq(schema.syncState.workspaceId, workspaceId),
    eq(schema.syncState.source, source)
  );
}

export type SourceLifecycleRow = {
  source: string;
  pausedAt: Date | null;
};

/** Stored source rows for a workspace, including pause stamps. */
export async function listSourceLifecycle(
  workspaceId: string
): Promise<SourceLifecycleRow[]> {
  const rows = await db
    .select({
      source: schema.sources.source,
      pausedAt: schema.sources.pausedAt,
    })
    .from(schema.sources)
    .where(eq(schema.sources.workspaceId, workspaceId))
    .all();
  return rows.map((row) => ({
    source: row.source,
    pausedAt: row.pausedAt ?? null,
  }));
}

/** Source slugs whose scheduler pass should be skipped. */
export async function loadPausedSources(
  workspaceId: string
): Promise<Set<string>> {
  const rows = await listSourceLifecycle(workspaceId);
  return new Set(
    rows.filter((row) => row.pausedAt != null).map((row) => row.source)
  );
}

async function loadSourceRow(workspaceId: string, source: string) {
  return db
    .select({
      source: schema.sources.source,
      pausedAt: schema.sources.pausedAt,
    })
    .from(schema.sources)
    .where(sourceWhere(workspaceId, source))
    .get();
}

/**
 * Delete stored credentials and sync_state. Synced rows stay, still
 * tagged with this source.
 */
export async function disconnectSource(
  workspaceId: string,
  source: string
): Promise<{ disconnected: boolean }> {
  const existing = await loadSourceRow(workspaceId, source);
  const state = await db
    .select({ source: schema.syncState.source })
    .from(schema.syncState)
    .where(syncWhere(workspaceId, source))
    .get();

  if (!existing && !state) {
    return { disconnected: false };
  }

  if (existing) {
    await db.delete(schema.sources).where(sourceWhere(workspaceId, source));
  }
  if (state) {
    await db.delete(schema.syncState).where(syncWhere(workspaceId, source));
  }
  return { disconnected: true };
}

/** Skip scheduling. Encrypted config stays. */
export async function pauseSource(
  workspaceId: string,
  source: string
): Promise<{ found: boolean; paused: boolean }> {
  const existing = await loadSourceRow(workspaceId, source);
  if (!existing) return { found: false, paused: false };

  if (!existing.pausedAt) {
    await db
      .update(schema.sources)
      .set({ pausedAt: new Date(), updatedAt: new Date() })
      .where(sourceWhere(workspaceId, source));
  }
  return { found: true, paused: true };
}

/** Restore scheduling. Encrypted config stays. */
export async function resumeSource(
  workspaceId: string,
  source: string
): Promise<{ found: boolean; paused: boolean }> {
  const existing = await loadSourceRow(workspaceId, source);
  if (!existing) return { found: false, paused: false };

  if (existing.pausedAt) {
    await db
      .update(schema.sources)
      .set({ pausedAt: null, updatedAt: new Date() })
      .where(sourceWhere(workspaceId, source));
  }
  return { found: true, paused: false };
}

/**
 * Acknowledge a stored pull error after the operator fixes the source.
 * Last successful sync stamp stays; status returns to success when one
 * exists, otherwise pending.
 */
export async function clearSourceError(
  workspaceId: string,
  source: string
): Promise<{ found: boolean; cleared: boolean }> {
  const state = await db
    .select()
    .from(schema.syncState)
    .where(syncWhere(workspaceId, source))
    .get();

  if (!state) {
    const connected = await loadSourceRow(workspaceId, source);
    return { found: Boolean(connected), cleared: false };
  }

  const nextStatus = state.lastSync ? "success" : "pending";
  await db
    .update(schema.syncState)
    .set({
      error: null,
      status: nextStatus,
    })
    .where(syncWhere(workspaceId, source));

  return { found: true, cleared: true };
}
