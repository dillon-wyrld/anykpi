/**
 * Person deletion tombstones.
 *
 * A deleted person is purged from users, events, and person-level read
 * models. Their workspace + external ids stay in `tombstones` so
 * connector upserts, CSV import, and ingest cannot recreate them.
 */

import { and, eq, inArray } from "drizzle-orm";
import { refreshWorkspaceClusters } from "./clustering";
import { db } from "./db";
import { persistWorkspaceMilestones } from "./milestones";
import * as schema from "./schema";

export type PersonIdentifiers = {
  personId: string;
  email?: string | null;
  accountId?: string | null;
};

/** Every external id a later upsert might use for this person. */
export function identifiersForPerson(input: PersonIdentifiers): string[] {
  const ids = new Set<string>();
  const add = (value?: string | null) => {
    const trimmed = value?.trim();
    if (trimmed) ids.add(trimmed);
  };
  add(input.personId);
  add(input.email);
  add(input.accountId);
  if (input.personId.startsWith("person_")) {
    add(input.personId.slice("person_".length));
  } else {
    add(`person_${input.personId}`);
  }
  return [...ids];
}

export function loadTombstoneSet(workspaceId: string): Set<string> {
  const rows = db
    .select({ externalId: schema.tombstones.externalId })
    .from(schema.tombstones)
    .where(eq(schema.tombstones.workspaceId, workspaceId))
    .all();
  return new Set(rows.map((row) => row.externalId));
}

export function matchesTombstone(
  tombstoned: Set<string>,
  input: PersonIdentifiers
): boolean {
  if (tombstoned.size === 0) return false;
  return identifiersForPerson(input).some((id) => tombstoned.has(id));
}

export async function isTombstoned(
  workspaceId: string,
  input: PersonIdentifiers
): Promise<boolean> {
  const ids = identifiersForPerson(input);
  if (ids.length === 0) return false;
  const row = await db
    .select({ externalId: schema.tombstones.externalId })
    .from(schema.tombstones)
    .where(
      and(
        eq(schema.tombstones.workspaceId, workspaceId),
        inArray(schema.tombstones.externalId, ids)
      )
    )
    .get();
  return Boolean(row);
}

export async function writeTombstones(
  workspaceId: string,
  ids: string[],
  at: Date = new Date()
): Promise<void> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  await db
    .insert(schema.tombstones)
    .values(
      unique.map((externalId) => ({
        workspaceId,
        externalId,
        createdAt: at,
      }))
    )
    .onConflictDoNothing({
      target: [schema.tombstones.workspaceId, schema.tombstones.externalId],
    });
}

export type PurgePersonResult = {
  found: boolean;
  personId: string;
  identifiers: string[];
};

/**
 * Remove the person and every person-level read model in the workspace.
 * Does not write a tombstone — callers that must survive re-sync should
 * use `deletePerson`.
 */
export async function purgePerson(
  workspaceId: string,
  personId: string
): Promise<PurgePersonResult> {
  const user = await db
    .select()
    .from(schema.users)
    .where(
      and(eq(schema.users.workspaceId, workspaceId), eq(schema.users.personId, personId))
    )
    .get();
  const revenue = await db
    .select({ accountId: schema.personRevenue.accountId })
    .from(schema.personRevenue)
    .where(
      and(
        eq(schema.personRevenue.workspaceId, workspaceId),
        eq(schema.personRevenue.personId, personId)
      )
    )
    .get();
  const activity = await db
    .select({ personId: schema.activity.personId })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.workspaceId, workspaceId),
        eq(schema.activity.personId, personId)
      )
    )
    .get();

  const identifiers = identifiersForPerson({
    personId,
    email: user?.email,
    accountId: user?.accountId ?? revenue?.accountId,
  });
  const found = Boolean(user || revenue || activity);

  await db
    .delete(schema.activity)
    .where(
      and(
        eq(schema.activity.workspaceId, workspaceId),
        eq(schema.activity.personId, personId)
      )
    );
  await db
    .delete(schema.seats)
    .where(
      and(eq(schema.seats.workspaceId, workspaceId), eq(schema.seats.personId, personId))
    );
  await db
    .delete(schema.personRevenue)
    .where(
      and(
        eq(schema.personRevenue.workspaceId, workspaceId),
        eq(schema.personRevenue.personId, personId)
      )
    );
  await db
    .delete(schema.subscriptionEvents)
    .where(
      and(
        eq(schema.subscriptionEvents.workspaceId, workspaceId),
        eq(schema.subscriptionEvents.personId, personId)
      )
    );

  const drafts = await db
    .select({ id: schema.outreach.id })
    .from(schema.outreach)
    .where(
      and(
        eq(schema.outreach.workspaceId, workspaceId),
        eq(schema.outreach.personId, personId)
      )
    )
    .all();
  const draftIds = drafts.map((row) => row.id);
  if (draftIds.length > 0) {
    await db
      .delete(schema.outreachDelivery)
      .where(inArray(schema.outreachDelivery.outreachId, draftIds));
  }
  await db
    .delete(schema.outreach)
    .where(
      and(
        eq(schema.outreach.workspaceId, workspaceId),
        eq(schema.outreach.personId, personId)
      )
    );

  await db
    .delete(schema.annotations)
    .where(
      and(
        eq(schema.annotations.workspaceId, workspaceId),
        eq(schema.annotations.targetType, "person"),
        eq(schema.annotations.targetId, personId)
      )
    );

  await db
    .delete(schema.users)
    .where(
      and(eq(schema.users.workspaceId, workspaceId), eq(schema.users.personId, personId))
    );

  return { found, personId, identifiers };
}

/**
 * Purge the person, write tombstones, and recompute clusters / milestones
 * so every view, API, and MCP answer drops them.
 */
export async function deletePerson(
  workspaceId: string,
  personId: string
): Promise<PurgePersonResult> {
  const result = await purgePerson(workspaceId, personId);
  if (!result.found) return result;
  await writeTombstones(workspaceId, result.identifiers);
  await refreshWorkspaceClusters(workspaceId);
  await persistWorkspaceMilestones(workspaceId);
  return result;
}
