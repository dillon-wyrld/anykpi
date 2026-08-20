import { createHash } from "crypto";
import { count, eq } from "drizzle-orm";
import { BATCH_INGEST_MAX_EVENTS } from "./contracts";
import { db } from "./db";
import { writeInTransaction } from "./query-compat";
import * as schema from "./schema";
import { loadTombstoneSet, matchesTombstone } from "./tombstones";
import { geographyFromProperties } from "./geography";
import { classifyEventName } from "./webhook";

export { BATCH_INGEST_MAX_EVENTS };
export const BATCH_INGEST_MAX_BYTES = 1024 * 1024;
const WRITE_CHUNK = 80;

export type IngestBatchEventInput = {
  userId: string;
  eventName: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  idempotencyKey?: string | null;
  externalId?: string | null;
};

export type IngestBatchWriteResult = {
  accepted: number;
  inserted: number;
  duplicates: number;
};

export type ActivityRow = {
  personId: string;
  timestamp: Date;
  eventName: string;
  eventClass: "core" | "search" | "share" | "pay";
  platform: string;
  externalId: string;
  workspaceId: string;
};

export type UserStub = {
  personId: string;
  name: string;
  email: string | null;
  emoji: string | null;
  platform: string;
  country: string | null;
  timezone: string | null;
  signupDate: Date;
  cluster: null;
  accountId: null;
  workspaceId: string;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function parseEventTimestamp(value: string | undefined): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** Stable identity stored in activity.externalId (unique with workspaceId). */
export function ingestEventExternalId(input: {
  personId: string;
  timestamp: Date;
  eventName: string;
  platform?: string | null;
  idempotencyKey?: string | null;
  externalId?: string | null;
}): string {
  const provided =
    asNonEmptyString(input.idempotencyKey) ?? asNonEmptyString(input.externalId);
  if (provided) return provided;
  const material = `ingest:${input.personId}:${input.timestamp.toISOString()}:${input.eventName}:${input.platform ?? ""}`;
  return createHash("sha256").update(material).digest("hex");
}

export async function countWorkspaceActivity(workspaceId: string): Promise<number> {
  const row = await db
    .select({ n: count() })
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .get();
  return Number(row?.n ?? 0);
}

export function prepareBatchEvents(
  workspaceId: string,
  events: IngestBatchEventInput[]
): { users: UserStub[]; activity: ActivityRow[] } {
  const users = new Map<string, UserStub>();
  const activity: ActivityRow[] = [];

  for (const event of events) {
    const personId = `person_${event.userId}`;
    const properties = event.properties ?? {};
    const platform = asNonEmptyString(properties.platform) ?? "web";
    const timestamp = parseEventTimestamp(event.timestamp);
    const eventName = event.eventName;
    const externalId = ingestEventExternalId({
      personId,
      timestamp,
      eventName,
      platform,
      idempotencyKey: event.idempotencyKey,
      externalId: event.externalId,
    });

    activity.push({
      personId,
      timestamp,
      eventName,
      eventClass: classifyEventName(eventName),
      platform,
      externalId,
      workspaceId,
    });

    if (!users.has(personId)) {
      const geo = geographyFromProperties(properties);
      users.set(personId, {
        personId,
        name: asNonEmptyString(properties.name) ?? `User ${event.userId}`,
        email: asNonEmptyString(properties.email) ?? null,
        emoji: asNonEmptyString(properties.emoji) ?? null,
        platform,
        country: geo.country,
        timezone: geo.timezone,
        signupDate: timestamp,
        cluster: null,
        accountId: null,
        workspaceId,
      });
    }
  }

  return { users: [...users.values()], activity };
}

/**
 * Insert users and activity in a single transaction.
 * Duplicates on (workspaceId, externalId) are no-ops.
 */
export async function runIngestBatch(
  workspaceId: string,
  events: IngestBatchEventInput[]
): Promise<IngestBatchWriteResult> {
  if (events.length === 0) {
    return { accepted: 0, inserted: 0, duplicates: 0 };
  }
  if (events.length > BATCH_INGEST_MAX_EVENTS) {
    throw new RangeError(`at most ${BATCH_INGEST_MAX_EVENTS} events`);
  }

  const prepared = prepareBatchEvents(workspaceId, events);
  const tombstoned = await loadTombstoneSet(workspaceId);
  const users = prepared.users.filter((user) => !matchesTombstone(tombstoned, user));
  const activity = prepared.activity.filter(
    (row) => !matchesTombstone(tombstoned, { personId: row.personId })
  );
  const before = await countWorkspaceActivity(workspaceId);

  await writeInTransaction(
    db,
    (tx) => {
      for (const batch of chunk(users, WRITE_CHUNK)) {
        tx.insert(schema.users)
          .values(batch)
          .onConflictDoNothing({
            target: [schema.users.workspaceId, schema.users.personId],
          })
          .run();
      }
      for (const batch of chunk(activity, WRITE_CHUNK)) {
        tx.insert(schema.activity)
          .values(batch)
          .onConflictDoNothing({
            target: [schema.activity.workspaceId, schema.activity.externalId],
          })
          .run();
      }
    },
    async (tx) => {
      for (const batch of chunk(users, WRITE_CHUNK)) {
        await tx
          .insert(schema.users)
          .values(batch)
          .onConflictDoNothing({
            target: [schema.users.workspaceId, schema.users.personId],
          });
      }
      for (const batch of chunk(activity, WRITE_CHUNK)) {
        await tx
          .insert(schema.activity)
          .values(batch)
          .onConflictDoNothing({
            target: [schema.activity.workspaceId, schema.activity.externalId],
          });
      }
    }
  );

  const inserted = (await countWorkspaceActivity(workspaceId)) - before;
  return {
    accepted: events.length,
    inserted,
    duplicates: events.length - inserted,
  };
}
