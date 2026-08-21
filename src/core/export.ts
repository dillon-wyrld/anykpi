/**
 * Workspace export — users, events, and read models as JSON or CSV.
 *
 * Users and events re-import through ANY-12 (`anykpi import` / POST /api/v1/import).
 * Connector-backed read models restore by re-syncing the source; import does
 * not write those tables.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./schema";
import { EVENT_FIELDS, USER_FIELDS } from "./csv-parse";

export const CONNECTOR_RESTORE_NOTE =
  "Connector-backed read models restore by re-syncing the source. CSV import writes users and events only.";

export const USERS_EVENTS_RESTORE_NOTE =
  "Re-import users.csv then events.csv with anykpi import (POST /api/v1/import).";

export const EXPORT_RESTORE = {
  usersAndEvents: USERS_EVENTS_RESTORE_NOTE,
  connectorReadModels: CONNECTOR_RESTORE_NOTE,
} as const;

export type ExportFormat = "json" | "csv";

export type ExportUserRow = {
  personId: string;
  name: string;
  email: string | null;
  platform: string | null;
  country: string | null;
  timezone: string | null;
  emoji: string | null;
  signupDate: string | null;
  cluster: string | null;
  accountId: string | null;
  workspaceId: string;
};

export type ExportEventRow = {
  id: number;
  personId: string;
  timestamp: string;
  eventName: string;
  eventClass: "core" | "search" | "share" | "pay";
  platform: string | null;
  externalId: string | null;
  workspaceId: string;
};

export type ExportReadModels = {
  accounts: Record<string, string | number | null>[];
  seats: Record<string, string | number | null>[];
  mrrSnapshots: Record<string, string | number | null>[];
  subscriptionEvents: Record<string, string | number | null>[];
  personRevenue: Record<string, string | number | null>[];
  balanceSnapshots: Record<string, string | number | null>[];
  calendarEvents: Record<string, string | number | null>[];
  metricDefs: Record<string, string | number | null>[];
  metricPoints: Record<string, string | number | null>[];
};

export type WorkspaceExport = {
  workspaceId: string;
  exportedAt: string;
  users: ExportUserRow[];
  events: ExportEventRow[];
  readModels: ExportReadModels;
};

export type ExportCounts = {
  users: number;
  events: number;
  readModelRows: number;
};

export type ExportEnvelope = {
  format: ExportFormat;
  workspaceId: string;
  exportedAt: string;
  counts: ExportCounts;
  restore: typeof EXPORT_RESTORE;
  users?: ExportUserRow[];
  events?: ExportEventRow[];
  readModels?: ExportReadModels;
  files?: Record<string, string>;
};

function iso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

function requiredIso(value: Date): string {
  return value.toISOString();
}

function isEventClass(value: string): value is ExportEventRow["eventClass"] {
  return value === "core" || value === "search" || value === "share" || value === "pay";
}

function readModelRowCount(readModels: ExportReadModels): number {
  return (
    readModels.accounts.length +
    readModels.seats.length +
    readModels.mrrSnapshots.length +
    readModels.subscriptionEvents.length +
    readModels.personRevenue.length +
    readModels.balanceSnapshots.length +
    readModels.calendarEvents.length +
    readModels.metricDefs.length +
    readModels.metricPoints.length
  );
}

export function exportCounts(bundle: WorkspaceExport): ExportCounts {
  return {
    users: bundle.users.length,
    events: bundle.events.length,
    readModelRows: readModelRowCount(bundle.readModels),
  };
}

export async function exportWorkspace(workspaceId: string): Promise<WorkspaceExport> {
  const users = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.workspaceId, workspaceId))
    .orderBy(asc(schema.users.personId))
    .all();

  const events = await db
    .select()
    .from(schema.activity)
    .where(eq(schema.activity.workspaceId, workspaceId))
    .orderBy(asc(schema.activity.timestamp), asc(schema.activity.personId))
    .all();

  const accounts = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.workspaceId, workspaceId))
    .orderBy(asc(schema.accounts.accountId))
    .all();

  const seats = await db
    .select()
    .from(schema.seats)
    .where(eq(schema.seats.workspaceId, workspaceId))
    .orderBy(asc(schema.seats.accountId), asc(schema.seats.personId))
    .all();

  const mrrSnapshots = await db
    .select()
    .from(schema.mrrSnapshots)
    .where(eq(schema.mrrSnapshots.workspaceId, workspaceId))
    .orderBy(asc(schema.mrrSnapshots.period))
    .all();

  const subscriptionEvents = await db
    .select()
    .from(schema.subscriptionEvents)
    .where(eq(schema.subscriptionEvents.workspaceId, workspaceId))
    .orderBy(asc(schema.subscriptionEvents.occurredAt))
    .all();

  const personRevenue = await db
    .select()
    .from(schema.personRevenue)
    .where(eq(schema.personRevenue.workspaceId, workspaceId))
    .orderBy(asc(schema.personRevenue.personId))
    .all();

  const balanceSnapshots = await db
    .select()
    .from(schema.balanceSnapshots)
    .where(eq(schema.balanceSnapshots.workspaceId, workspaceId))
    .orderBy(asc(schema.balanceSnapshots.asOf))
    .all();

  const calendarEvents = await db
    .select()
    .from(schema.calEvents)
    .where(eq(schema.calEvents.workspaceId, workspaceId))
    .orderBy(asc(schema.calEvents.eventDate))
    .all();

  const metricDefs = await db
    .select()
    .from(schema.metricDefs)
    .where(eq(schema.metricDefs.workspaceId, workspaceId))
    .orderBy(asc(schema.metricDefs.metricId))
    .all();

  const metricPoints = await db
    .select()
    .from(schema.metricPoints)
    .where(eq(schema.metricPoints.workspaceId, workspaceId))
    .orderBy(asc(schema.metricPoints.metricId), asc(schema.metricPoints.timestamp))
    .all();

  return {
    workspaceId,
    exportedAt: new Date().toISOString(),
    users: users.map((row) => ({
      personId: row.personId,
      name: row.name,
      email: row.email ?? null,
      platform: row.platform ?? null,
      country: row.country ?? null,
      timezone: row.timezone ?? null,
      emoji: row.emoji ?? null,
      signupDate: iso(row.signupDate),
      cluster: row.cluster ?? null,
      accountId: row.accountId ?? null,
      workspaceId: row.workspaceId,
    })),
    events: events.map((row) => ({
      id: row.id,
      personId: row.personId,
      timestamp: requiredIso(row.timestamp),
      eventName: row.eventName,
      eventClass: isEventClass(row.eventClass) ? row.eventClass : "core",
      platform: row.platform ?? null,
      externalId: row.externalId ?? null,
      workspaceId: row.workspaceId,
    })),
    readModels: {
      accounts: accounts.map((row) => ({
        accountId: row.accountId,
        name: row.name,
        entity: row.entity ?? null,
        seats: row.seats ?? 0,
        activated: row.activated ?? 0,
        mrr: row.mrr ?? 0,
        renewalDate: iso(row.renewalDate),
        workspaceId: row.workspaceId,
      })),
      seats: seats.map((row) => ({
        id: row.id,
        accountId: row.accountId,
        personId: row.personId,
        role: row.role ?? null,
        workspaceId: row.workspaceId,
      })),
      mrrSnapshots: mrrSnapshots.map((row) => ({
        id: row.id,
        period: requiredIso(row.period),
        grain: row.grain,
        mrr: row.mrr,
        subscriberCount: row.subscriberCount,
        source: row.source,
        workspaceId: row.workspaceId,
      })),
      subscriptionEvents: subscriptionEvents.map((row) => ({
        id: row.id,
        personId: row.personId,
        accountId: row.accountId ?? null,
        eventType: row.eventType,
        occurredAt: requiredIso(row.occurredAt),
        mrrDelta: row.mrrDelta,
        plan: row.plan ?? null,
        source: row.source,
        sourceEventId: row.sourceEventId,
        workspaceId: row.workspaceId,
      })),
      personRevenue: personRevenue.map((row) => ({
        id: row.id,
        personId: row.personId,
        accountId: row.accountId ?? null,
        status: row.status,
        plan: row.plan ?? null,
        mrr: row.mrr,
        ltv: row.ltv,
        firstPaidAt: iso(row.firstPaidAt),
        lastChargeAt: iso(row.lastChargeAt),
        chargeCount: row.chargeCount,
        lastChargeAmount: row.lastChargeAmount ?? null,
        currency: row.currency,
        source: row.source,
        workspaceId: row.workspaceId,
      })),
      balanceSnapshots: balanceSnapshots.map((row) => ({
        id: row.id,
        asOf: requiredIso(row.asOf),
        cashBalance: row.cashBalance,
        monthlyBurn: row.monthlyBurn,
        runwayMonths: row.runwayMonths,
        source: row.source,
        workspaceId: row.workspaceId,
      })),
      calendarEvents: calendarEvents.map((row) => ({
        id: row.id,
        source: row.source,
        sourceName: row.sourceName,
        sourceColor: row.sourceColor,
        type: row.type,
        emoji: row.emoji,
        title: row.title,
        badge: row.badge,
        eventDate: requiredIso(row.eventDate),
        isFuture: row.isFuture ? 1 : 0,
        workspaceId: row.workspaceId,
      })),
      metricDefs: metricDefs.map((row) => ({
        metricId: row.metricId,
        name: row.name,
        section: row.section,
        sectionOrder: row.sectionOrder,
        owner: row.owner,
        type: row.type,
        unit: row.unit ?? null,
        target: row.target ?? null,
        goodDir: row.goodDir,
        status: row.status,
        statusReason: row.statusReason ?? null,
        workspaceId: row.workspaceId,
      })),
      metricPoints: metricPoints.map((row) => ({
        id: row.id,
        metricId: row.metricId,
        timestamp: requiredIso(row.timestamp),
        value: row.value ?? null,
        grain: row.grain,
        workspaceId: row.workspaceId,
      })),
    },
  };
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return csvEscape(String(value));
}

export function rowsToCsv(
  headers: readonly string[],
  rows: Array<Record<string, string | number | null | undefined>>
): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => cell(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

const READ_MODEL_FILES: Array<{
  file: string;
  key: keyof ExportReadModels;
  headers: string[];
}> = [
  {
    file: "accounts.csv",
    key: "accounts",
    headers: [
      "accountId",
      "name",
      "entity",
      "seats",
      "activated",
      "mrr",
      "renewalDate",
      "workspaceId",
    ],
  },
  {
    file: "seats.csv",
    key: "seats",
    headers: ["id", "accountId", "personId", "role", "workspaceId"],
  },
  {
    file: "mrr_snapshots.csv",
    key: "mrrSnapshots",
    headers: [
      "id",
      "period",
      "grain",
      "mrr",
      "subscriberCount",
      "source",
      "workspaceId",
    ],
  },
  {
    file: "subscription_events.csv",
    key: "subscriptionEvents",
    headers: [
      "id",
      "personId",
      "accountId",
      "eventType",
      "occurredAt",
      "mrrDelta",
      "plan",
      "source",
      "sourceEventId",
      "workspaceId",
    ],
  },
  {
    file: "person_revenue.csv",
    key: "personRevenue",
    headers: [
      "id",
      "personId",
      "accountId",
      "status",
      "plan",
      "mrr",
      "ltv",
      "firstPaidAt",
      "lastChargeAt",
      "chargeCount",
      "lastChargeAmount",
      "currency",
      "source",
      "workspaceId",
    ],
  },
  {
    file: "balance_snapshots.csv",
    key: "balanceSnapshots",
    headers: [
      "id",
      "asOf",
      "cashBalance",
      "monthlyBurn",
      "runwayMonths",
      "source",
      "workspaceId",
    ],
  },
  {
    file: "calendar_events.csv",
    key: "calendarEvents",
    headers: [
      "id",
      "source",
      "sourceName",
      "sourceColor",
      "type",
      "emoji",
      "title",
      "badge",
      "eventDate",
      "isFuture",
      "workspaceId",
    ],
  },
  {
    file: "metric_defs.csv",
    key: "metricDefs",
    headers: [
      "metricId",
      "name",
      "section",
      "sectionOrder",
      "owner",
      "type",
      "unit",
      "target",
      "goodDir",
      "status",
      "statusReason",
      "workspaceId",
    ],
  },
  {
    file: "metric_points.csv",
    key: "metricPoints",
    headers: ["id", "metricId", "timestamp", "value", "grain", "workspaceId"],
  },
];

export function exportToCsvFiles(bundle: WorkspaceExport): Record<string, string> {
  const files: Record<string, string> = {
    "users.csv": rowsToCsv(USER_FIELDS, bundle.users),
    "events.csv": rowsToCsv(EVENT_FIELDS, bundle.events),
  };

  for (const spec of READ_MODEL_FILES) {
    files[spec.file] = rowsToCsv(spec.headers, bundle.readModels[spec.key]);
  }

  return files;
}

export function formatExport(bundle: WorkspaceExport, format: ExportFormat): ExportEnvelope {
  const counts = exportCounts(bundle);
  const base = {
    workspaceId: bundle.workspaceId,
    exportedAt: bundle.exportedAt,
    counts,
    restore: EXPORT_RESTORE,
  };

  if (format === "csv") {
    return {
      format: "csv",
      ...base,
      files: exportToCsvFiles(bundle),
    };
  }

  return {
    format: "json",
    ...base,
    users: bundle.users,
    events: bundle.events,
    readModels: bundle.readModels,
  };
}
