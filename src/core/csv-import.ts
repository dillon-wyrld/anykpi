import { createHash } from "crypto";
import { count, eq } from "drizzle-orm";
import { db } from "./db";
import { excluded, writeInTransaction } from "./query-compat";
import * as schema from "./schema";
import type { SourceConfig } from "./sources";
import { resolveGeography } from "./geography";
import { loadTombstoneSet, matchesTombstone } from "./tombstones";
import {
  applyMapping,
  detectKind,
  isImportField,
  mappedFields,
  parseCsv,
  previewCsv,
  suggestMapping,
  type CsvImportPreview,
  type CsvRecord,
  type ImportKind,
} from "./csv-parse";

export type { CsvImportPreview, ImportKind } from "./csv-parse";

export type ImportRowError = {
  line: number;
  message: string;
};

export type CsvImportResult = {
  workspaceId: string;
  kind: ImportKind;
  imported: number;
  skipped: number;
  errors: ImportRowError[];
};

export type CsvImportInput = {
  csv: string;
  workspaceId: string;
  kind?: ImportKind;
  mapping?: Record<string, string>;
  preview?: boolean;
};

export type CsvImportOutcome =
  | { status: "preview"; preview: CsvImportPreview }
  | { status: "invalid"; errors: ImportRowError[] }
  | { status: "ok"; result: CsvImportResult };

const BATCH = 400;
const EVENT_CLASSES = new Set(["core", "search", "share", "pay"]);

/** Sources-store id for CSV mapping. Encrypted at rest like other sources. */
export const CSV_SOURCE = "csv";

export function csvSourceConfig(
  kind: ImportKind,
  mapping: Record<string, string>
): SourceConfig {
  return {
    kind,
    mapping: JSON.stringify(mapping),
  };
}

export function parseCsvSourceConfig(config: SourceConfig | null): {
  kind?: ImportKind;
  mapping?: Record<string, string>;
} {
  if (!config) return {};
  const kind = config.kind === "users" || config.kind === "events" ? config.kind : undefined;
  if (!config.mapping) return { kind };
  try {
    const parsed = JSON.parse(config.mapping) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { kind };
    }
    const mapping: Record<string, string> = {};
    for (const [column, field] of Object.entries(parsed)) {
      if (typeof field === "string" && field.length > 0) {
        mapping[column] = field;
      }
    }
    return { kind, mapping: Object.keys(mapping).length > 0 ? mapping : undefined };
  } catch {
    return { kind };
  }
}

export function eventExternalId(input: {
  personId: string;
  timestamp: Date;
  eventName: string;
  platform?: string | null;
  externalId?: string | null;
}): string {
  const provided = input.externalId?.trim();
  if (provided) return provided;
  const material = `csv:${input.personId}:${input.timestamp.toISOString()}:${input.eventName}:${input.platform ?? ""}`;
  return createHash("sha256").update(material).digest("hex");
}

export function classifyEvent(eventName: string): "core" | "search" | "share" | "pay" {
  const eventLower = eventName.toLowerCase();
  if (eventLower.includes("search") || eventLower.includes("query")) return "search";
  if (eventLower.includes("share") || eventLower.includes("invite")) return "share";
  if (
    eventLower.includes("pay") ||
    eventLower.includes("purchase") ||
    eventLower.includes("subscribe")
  ) {
    return "pay";
  }
  return "core";
}

export function parseTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{13}$/.test(trimmed)) {
    const date = new Date(Number(trimmed));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (/^\d{10}$/.test(trimmed)) {
    const date = new Date(Number(trimmed) * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function resolveKindAndMapping(
  headers: string[],
  kind: ImportKind | undefined,
  mapping: Record<string, string> | undefined
): { kind: ImportKind; mapping: Record<string, string> } | { errors: ImportRowError[] } {
  const resolvedKind = kind ?? detectKind(headers);
  if (!resolvedKind) {
    return {
      errors: [
        {
          line: 1,
          message: "Could not detect file kind; pass kind=users or kind=events",
        },
      ],
    };
  }

  const resolvedMapping =
    mapping && Object.keys(mapping).length > 0
      ? mapping
      : suggestMapping(headers, resolvedKind);

  for (const [column, field] of Object.entries(resolvedMapping)) {
    if (!headers.includes(column)) {
      return {
        errors: [{ line: 1, message: `Mapped column "${column}" is not in the file` }],
      };
    }
    if (!isImportField(resolvedKind, field)) {
      return {
        errors: [{ line: 1, message: `Unknown ${resolvedKind} field "${field}"` }],
      };
    }
  }

  const fields = mappedFields(resolvedMapping);
  if (resolvedKind === "events") {
    if (!fields.has("personId") || !fields.has("timestamp") || !fields.has("eventName")) {
      return {
        errors: [
          {
            line: 1,
            message: "Events require personId, timestamp, and eventName columns",
          },
        ],
      };
    }
  } else if (!fields.has("personId") && !fields.has("name") && !fields.has("email")) {
    return {
      errors: [{ line: 1, message: "Users require a personId, name, or email column" }],
    };
  }

  return { kind: resolvedKind, mapping: resolvedMapping };
}

type UserRow = {
  personId: string;
  name: string;
  email: string | null;
  emoji: string | null;
  platform: string | null;
  country: string | null;
  timezone: string | null;
  signupDate: Date;
  cluster: string | null;
  accountId: string | null;
  workspaceId: string;
};

type EventRow = {
  personId: string;
  timestamp: Date;
  eventName: string;
  eventClass: "core" | "search" | "share" | "pay";
  platform: string | null;
  externalId: string;
  workspaceId: string;
};

function validateUsers(
  headers: string[],
  records: CsvRecord[],
  mapping: Record<string, string>,
  workspaceId: string
): { errors: ImportRowError[]; rows: UserRow[] } {
  const errors: ImportRowError[] = [];
  const rows: UserRow[] = [];

  for (const record of records) {
    const fields = applyMapping(headers, record, mapping);
    const personId = (fields.personId || fields.email || fields.name || "").trim();
    if (!personId) {
      errors.push({ line: record.line, message: "missing personId" });
      continue;
    }
    if (fields.email && !isEmail(fields.email)) {
      errors.push({ line: record.line, message: "invalid email" });
      continue;
    }
    let signupDate = new Date();
    if (fields.signupDate) {
      const parsed = parseTimestamp(fields.signupDate);
      if (!parsed) {
        errors.push({ line: record.line, message: "invalid signupDate" });
        continue;
      }
      signupDate = parsed;
    }
    const geo = resolveGeography({
      country: fields.country || null,
      timezone: fields.timezone || null,
    });
    rows.push({
      personId,
      name: (fields.name || personId).trim(),
      email: fields.email || null,
      emoji: fields.emoji || null,
      platform: fields.platform || null,
      country: geo.country,
      timezone: geo.timezone,
      signupDate,
      cluster: fields.cluster || null,
      accountId: fields.accountId || null,
      workspaceId,
    });
  }

  return { errors, rows };
}

function validateEvents(
  headers: string[],
  records: CsvRecord[],
  mapping: Record<string, string>,
  workspaceId: string
): { errors: ImportRowError[]; rows: EventRow[] } {
  const errors: ImportRowError[] = [];
  const rows: EventRow[] = [];

  for (const record of records) {
    const fields = applyMapping(headers, record, mapping);
    const personId = (fields.personId || "").trim();
    const eventName = (fields.eventName || "").trim();
    if (!personId) {
      errors.push({ line: record.line, message: "missing personId" });
      continue;
    }
    if (!eventName) {
      errors.push({ line: record.line, message: "missing eventName" });
      continue;
    }
    if (!fields.timestamp) {
      errors.push({ line: record.line, message: "missing timestamp" });
      continue;
    }
    const timestamp = parseTimestamp(fields.timestamp);
    if (!timestamp) {
      errors.push({ line: record.line, message: "invalid timestamp" });
      continue;
    }
    if (fields.eventClass && !EVENT_CLASSES.has(fields.eventClass)) {
      errors.push({
        line: record.line,
        message: "invalid eventClass (use core, search, share, or pay)",
      });
      continue;
    }
    const platform = fields.platform || null;
    const eventClass = fields.eventClass
      ? (fields.eventClass as EventRow["eventClass"])
      : classifyEvent(eventName);
    rows.push({
      personId,
      timestamp,
      eventName,
      eventClass,
      platform,
      externalId: eventExternalId({
        personId,
        timestamp,
        eventName,
        platform,
        externalId: fields.externalId,
      }),
      workspaceId,
    });
  }

  return { errors, rows };
}

async function countWorkspaceUsers(workspaceId: string): Promise<number> {
  const row = await db
    .select({ n: count() })
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspaceId))
    .get();
  return Number(row?.n ?? 0);
}

async function countWorkspaceActivity(workspaceId: string): Promise<number> {
  const row = await db
    .select({ n: count() })
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .get();
  return Number(row?.n ?? 0);
}

/**
 * Validate every row, then write in one transaction. Bad rows abort the
 * import so nothing is silently dropped.
 */
export async function runCsvImport(input: CsvImportInput): Promise<CsvImportOutcome> {
  const parsed = parseCsv(input.csv);
  if (!parsed.ok) {
    return { status: "invalid", errors: [{ line: parsed.line, message: parsed.message }] };
  }

  const resolved = resolveKindAndMapping(parsed.headers, input.kind, input.mapping);
  if ("errors" in resolved) {
    return { status: "invalid", errors: resolved.errors };
  }

  if (input.preview) {
    return {
      status: "preview",
      preview: previewCsv(parsed.headers, parsed.records, resolved.kind, resolved.mapping),
    };
  }

  if (resolved.kind === "users") {
    const { errors, rows } = validateUsers(
      parsed.headers,
      parsed.records,
      resolved.mapping,
      input.workspaceId
    );
    if (errors.length > 0) {
      return { status: "invalid", errors };
    }
    const tombstoned = await loadTombstoneSet(input.workspaceId);
    const liveRows = rows.filter(
      (row) => !matchesTombstone(tombstoned, row)
    );
    const before = await countWorkspaceUsers(input.workspaceId);
    const userConflict = {
      target: [schema.users.workspaceId, schema.users.personId],
      set: {
        name: excluded("name"),
        email: excluded("email"),
        emoji: excluded("emoji"),
        platform: excluded("platform"),
        country: excluded("country"),
        timezone: excluded("timezone"),
        signupDate: excluded("signup_date"),
        cluster: excluded("cluster"),
        accountId: excluded("account_id"),
      },
    };
    await writeInTransaction(
      db,
      (tx) => {
        for (const batch of chunk(liveRows, BATCH)) {
          tx.insert(schema.users)
            .values(batch)
            .onConflictDoUpdate(userConflict)
            .run();
        }
      },
      async (tx) => {
        for (const batch of chunk(liveRows, BATCH)) {
          await tx.insert(schema.users).values(batch).onConflictDoUpdate(userConflict);
        }
      }
    );
    const after = await countWorkspaceUsers(input.workspaceId);
    const imported = after - before;
    return {
      status: "ok",
      result: {
        workspaceId: input.workspaceId,
        kind: "users",
        imported,
        skipped: rows.length - imported,
        errors: [],
      },
    };
  }

  const { errors, rows } = validateEvents(
    parsed.headers,
    parsed.records,
    resolved.mapping,
    input.workspaceId
  );
  if (errors.length > 0) {
    return { status: "invalid", errors };
  }

  const tombstoned = await loadTombstoneSet(input.workspaceId);
  const liveRows = rows.filter(
    (row) => !matchesTombstone(tombstoned, { personId: row.personId })
  );

  const stubs = new Map<string, UserRow>();
  for (const row of liveRows) {
    if (stubs.has(row.personId)) continue;
    stubs.set(row.personId, {
      personId: row.personId,
      name: row.personId,
      email: null,
      emoji: null,
      platform: row.platform,
      country: null,
      timezone: null,
      signupDate: row.timestamp,
      cluster: null,
      accountId: null,
      workspaceId: input.workspaceId,
    });
  }

  const before = await countWorkspaceActivity(input.workspaceId);
  await writeInTransaction(
    db,
    (tx) => {
      for (const batch of chunk([...stubs.values()], BATCH)) {
        tx.insert(schema.users)
          .values(batch)
          .onConflictDoNothing({
            target: [schema.users.workspaceId, schema.users.personId],
          })
          .run();
      }
      for (const batch of chunk(liveRows, BATCH)) {
        tx.insert(schema.activity)
          .values(batch)
          .onConflictDoNothing({
            target: [schema.activity.workspaceId, schema.activity.externalId],
          })
          .run();
      }
    },
    async (tx) => {
      for (const batch of chunk([...stubs.values()], BATCH)) {
        await tx.insert(schema.users).values(batch).onConflictDoNothing({
          target: [schema.users.workspaceId, schema.users.personId],
        });
      }
      for (const batch of chunk(liveRows, BATCH)) {
        await tx.insert(schema.activity).values(batch).onConflictDoNothing({
          target: [schema.activity.workspaceId, schema.activity.externalId],
        });
      }
    }
  );
  const after = await countWorkspaceActivity(input.workspaceId);
  const imported = after - before;
  return {
    status: "ok",
    result: {
      workspaceId: input.workspaceId,
      kind: "events",
      imported,
      skipped: rows.length - imported,
      errors: [],
    },
  };
}

export function formatImportErrors(errors: ImportRowError[]): string {
  const shown = errors.slice(0, 20);
  const detail = shown.map((error) => `line ${error.line}: ${error.message}`).join("; ");
  const extra = errors.length > shown.length ? ` (+${errors.length - shown.length} more)` : "";
  return `Invalid rows (${errors.length}): ${detail}${extra}`;
}
