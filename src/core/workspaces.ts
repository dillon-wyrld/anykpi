/**
 * Workspace catalog. Isolation lives on composite keys; this table is
 * the named list the switcher and key minting read.
 */

import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { DEMO_WORKSPACE, LIVE_WORKSPACE } from "./auth";
import { purgeWorkspace } from "./tombstones";

export const WORKSPACE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

export const WORKSPACE_ID_ERROR =
  "Workspace id must be 1–64 characters: start with a letter, then letters, digits, _ or -.";

export const WORKSPACE_DELETE_CONFIRM_ERROR =
  "Type the workspace name to confirm deletion";

/** Exact display-name match after trim. Used by REST and the switcher. */
export function typedNameConfirms(typed: string, name: string): boolean {
  return typed.trim() === name;
}

const DISPLAY_NAMES: Record<string, string> = {
  [DEMO_WORKSPACE]: "Demo",
  [LIVE_WORKSPACE]: "Live",
};

export type WorkspaceRow = {
  id: string;
  name: string;
  createdAt: Date;
  archivedAt: Date | null;
};

export function isWorkspaceId(value: string): boolean {
  return WORKSPACE_ID_PATTERN.test(value);
}

export function displayNameFor(id: string, stored?: string | null): string {
  const trimmed = stored?.trim();
  if (trimmed) return trimmed;
  return DISPLAY_NAMES[id] ?? id;
}

export async function listWorkspaces(options?: {
  includeArchived?: boolean;
}): Promise<WorkspaceRow[]> {
  await ensureDefaultWorkspaces();
  const rows = await db.select().from(schema.workspaces).all();
  const visible = options?.includeArchived
    ? rows
    : rows.filter((row) => row.archivedAt == null);
  return visible
    .map((row) => ({
      id: row.id,
      name: displayNameFor(row.id, row.name),
      createdAt: row.createdAt,
      archivedAt: row.archivedAt,
    }))
    .sort((a, b) => {
      if (a.id === DEMO_WORKSPACE) return -1;
      if (b.id === DEMO_WORKSPACE) return 1;
      if (a.id === LIVE_WORKSPACE) return -1;
      if (b.id === LIVE_WORKSPACE) return 1;
      return a.id.localeCompare(b.id);
    });
}

export async function getWorkspace(id: string): Promise<WorkspaceRow | null> {
  const row = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: displayNameFor(row.id, row.name),
    createdAt: row.createdAt,
    archivedAt: row.archivedAt,
  };
}

/** Insert the catalog row if missing. Safe to call on ingest / key mint. */
export async function ensureWorkspace(
  id: string,
  name?: string
): Promise<WorkspaceRow> {
  const existing = await getWorkspace(id);
  if (existing) return existing;
  const createdAt = new Date();
  await db.insert(schema.workspaces).values({
    id,
    name: displayNameFor(id, name),
    createdAt,
    archivedAt: null,
  });
  return {
    id,
    name: displayNameFor(id, name),
    createdAt,
    archivedAt: null,
  };
}

export async function ensureDefaultWorkspaces(): Promise<void> {
  await ensureWorkspace(DEMO_WORKSPACE, DISPLAY_NAMES[DEMO_WORKSPACE]);
  await ensureWorkspace(LIVE_WORKSPACE, DISPLAY_NAMES[LIVE_WORKSPACE]);
}

export async function createWorkspace(
  id: string,
  name: string
): Promise<{ ok: true; workspace: WorkspaceRow } | { ok: false; error: string }> {
  if (!isWorkspaceId(id)) {
    return { ok: false, error: WORKSPACE_ID_ERROR };
  }
  const existing = await getWorkspace(id);
  if (existing) {
    return { ok: false, error: "Workspace already exists" };
  }
  const workspace = await ensureWorkspace(id, name.trim() || displayNameFor(id));
  return { ok: true, workspace };
}

export async function archiveWorkspace(
  id: string
): Promise<{ ok: true; workspace: WorkspaceRow } | { ok: false; error: string }> {
  if (id === DEMO_WORKSPACE) {
    return { ok: false, error: "The demo workspace cannot be archived" };
  }
  const existing = await getWorkspace(id);
  if (!existing) {
    return { ok: false, error: "Workspace not found" };
  }
  if (existing.archivedAt) {
    return { ok: true, workspace: existing };
  }
  const archivedAt = new Date();
  await db
    .update(schema.workspaces)
    .set({ archivedAt })
    .where(eq(schema.workspaces.id, id));
  return { ok: true, workspace: { ...existing, archivedAt } };
}

export async function deleteWorkspace(
  id: string,
  typedName: string
): Promise<
  | { ok: true; workspace: WorkspaceRow }
  | { ok: false; error: string; notFound?: boolean }
> {
  const existing = await getWorkspace(id);
  if (!existing) {
    return { ok: false, error: "Workspace not found", notFound: true };
  }
  if (!typedNameConfirms(typedName, existing.name)) {
    return { ok: false, error: WORKSPACE_DELETE_CONFIRM_ERROR };
  }
  await purgeWorkspace(id);
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
  return { ok: true, workspace: existing };
}
