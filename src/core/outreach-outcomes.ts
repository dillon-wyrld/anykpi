/**
 * Outreach outcome tags (replied / interviewed / converted).
 *
 * ANY-26's `outreach` row has no outcome column, and ANY-38 owns the
 * next migration — so tags live in the existing `config` table, keyed
 * by outreach id. Unique is `(key, workspace_id)`; `key` is also the
 * row primary key, so the slot includes the workspace.
 */

import { and, eq } from "drizzle-orm";
import { AUDIT_ACTIONS, recordAudit } from "@/core/audit";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { upsertConfig } from "@/core/upsert";
import { OutreachNotFoundError } from "@/outreach/errors";

export const OUTREACH_OUTCOMES = ["replied", "interviewed", "converted"] as const;
export type OutreachOutcome = (typeof OUTREACH_OUTCOMES)[number];

export const UNCLUSTERED_LABEL = "unclustered";

const OUTCOME_KEY_PREFIX = "outreach.outcome:";

const OUTCOME_RANK: Record<OutreachOutcome, number> = {
  replied: 1,
  interviewed: 2,
  converted: 3,
};

export type OutreachConversionByCluster = {
  cluster: string;
  outreach: number;
  sent: number;
  replied: number;
  interviewed: number;
  converted: number;
  conversionRate: number;
};

export function outreachOutcomeConfigKey(
  workspaceId: string,
  outreachId: string
): string {
  return `${OUTCOME_KEY_PREFIX}${workspaceId}:${outreachId}`;
}

export function parseOutreachOutcome(value: string | null | undefined): OutreachOutcome | null {
  if (value === "replied" || value === "interviewed" || value === "converted") {
    return value;
  }
  return null;
}

export function parseStoredOutreachOutcome(raw: string | null | undefined): OutreachOutcome | null {
  if (!raw) return null;
  const direct = parseOutreachOutcome(raw);
  if (direct) return direct;
  try {
    const parsed = JSON.parse(raw) as { outcome?: unknown };
    return typeof parsed.outcome === "string" ? parseOutreachOutcome(parsed.outcome) : null;
  } catch {
    return null;
  }
}

export function outcomeAtLeast(
  outcome: OutreachOutcome | null,
  threshold: OutreachOutcome
): boolean {
  if (!outcome) return false;
  return OUTCOME_RANK[outcome] >= OUTCOME_RANK[threshold];
}

export function resolveOutreachCluster(
  personId: string,
  people: Array<{ personId: string; name?: string | null; cluster?: string | null }>
): string {
  const exact = people.find((person) => person.personId === personId);
  if (exact?.cluster) return exact.cluster;
  const needle = personId.toLowerCase();
  const named = people.find(
    (person) => person.name && person.name.toLowerCase() === needle
  );
  if (named?.cluster) return named.cluster;
  return UNCLUSTERED_LABEL;
}

export function outreachConversionByCluster(
  rows: Array<{
    cluster: string;
    sent: boolean;
    outcome: OutreachOutcome | null;
  }>
): OutreachConversionByCluster[] {
  const byCluster = new Map<
    string,
    { outreach: number; sent: number; replied: number; interviewed: number; converted: number }
  >();

  for (const row of rows) {
    const current = byCluster.get(row.cluster) ?? {
      outreach: 0,
      sent: 0,
      replied: 0,
      interviewed: 0,
      converted: 0,
    };
    current.outreach += 1;
    if (row.sent) current.sent += 1;
    if (outcomeAtLeast(row.outcome, "replied")) current.replied += 1;
    if (outcomeAtLeast(row.outcome, "interviewed")) current.interviewed += 1;
    if (outcomeAtLeast(row.outcome, "converted")) current.converted += 1;
    byCluster.set(row.cluster, current);
  }

  return [...byCluster.entries()]
    .map(([cluster, counts]) => ({
      cluster,
      ...counts,
      conversionRate: counts.sent ? counts.converted / counts.sent : 0,
    }))
    .sort((a, b) => b.converted - a.converted || b.sent - a.sent || a.cluster.localeCompare(b.cluster));
}

export async function listOutreachOutcomes(
  workspaceId: string
): Promise<Map<string, OutreachOutcome>> {
  const rows = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.workspaceId, workspaceId))
    .all();

  const prefix = `${OUTCOME_KEY_PREFIX}${workspaceId}:`;
  const tagged = new Map<string, OutreachOutcome>();
  for (const row of rows) {
    if (!row.key.startsWith(prefix)) continue;
    const outcome = parseStoredOutreachOutcome(row.value);
    if (!outcome) continue;
    tagged.set(row.key.slice(prefix.length), outcome);
  }
  return tagged;
}

export async function getOutreachOutcome(
  workspaceId: string,
  outreachId: string
): Promise<OutreachOutcome | null> {
  const [row] = await db
    .select()
    .from(schema.config)
    .where(eq(schema.config.key, outreachOutcomeConfigKey(workspaceId, outreachId)))
    .all();
  return parseStoredOutreachOutcome(row?.value);
}

export async function setOutreachOutcome(input: {
  workspaceId: string;
  id: string;
  outcome: OutreachOutcome | null;
  actor: string;
}): Promise<OutreachOutcome | null> {
  const [existing] = await db
    .select({ id: schema.outreach.id })
    .from(schema.outreach)
    .where(
      and(
        eq(schema.outreach.workspaceId, input.workspaceId),
        eq(schema.outreach.id, input.id)
      )
    )
    .all();
  if (!existing) throw new OutreachNotFoundError();

  const key = outreachOutcomeConfigKey(input.workspaceId, input.id);
  if (input.outcome) {
    await upsertConfig({
      key,
      value: input.outcome,
      workspaceId: input.workspaceId,
    });
  } else {
    await db.delete(schema.config).where(eq(schema.config.key, key));
  }

  await recordAudit({
    workspaceId: input.workspaceId,
    actor: input.actor,
    action: AUDIT_ACTIONS.outreachOutcome,
    subject: input.id,
  });

  return input.outcome;
}

export async function loadOutreachConversion(
  workspaceId: string
): Promise<OutreachConversionByCluster[]> {
  const [drafts, outcomes, people] = await Promise.all([
    db
      .select({
        id: schema.outreach.id,
        personId: schema.outreach.personId,
        state: schema.outreach.state,
      })
      .from(schema.outreach)
      .where(eq(schema.outreach.workspaceId, workspaceId))
      .all(),
    listOutreachOutcomes(workspaceId),
    db
      .select({
        personId: schema.users.personId,
        name: schema.users.name,
        cluster: schema.users.cluster,
      })
      .from(schema.users)
      .where(eq(schema.users.workspaceId, workspaceId))
      .all(),
  ]);

  return outreachConversionByCluster(
    drafts.map((draft) => ({
      cluster: resolveOutreachCluster(draft.personId, people),
      sent: draft.state === "sent",
      outcome: outcomes.get(draft.id) ?? null,
    }))
  );
}
