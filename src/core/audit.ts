/**
 * Action audit log — the trust substrate for autonomous agents.
 *
 * Every successful keyed write records actor (key id, `env`, or `session`),
 * action, subject, and timestamp. HMAC inbound writes use actor `webhook`.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import {
  actorFromAuth,
  AUDIT_ACTOR_WEBHOOK,
  isReadOnlyMcpTool,
  type AuthOk,
} from "./auth";
import { db } from "./db";
import * as schema from "./schema";

export const AUDIT_ACTIONS = {
  ingestIdentify: "ingest.identify",
  ingestEvent: "ingest.event",
  ingestBatch: "ingest.batch",
  ingestWebhook: "ingest.webhook",
  connectSave: "connect.save",
  importCsv: "import.csv",
  syncTrigger: "sync.trigger",
  keysCreate: "keys.create",
  keysRevoke: "keys.revoke",
  keysDowngrade: "keys.downgrade",
  webhookStripe: "webhook.stripe",
  mcpCall: "mcp.call",
  outreachQueue: "outreach.queue",
  outreachApprove: "outreach.approve",
  outreachSend: "outreach.send",
  outreachOutcome: "outreach.outcome",
  usersDelete: "users.delete",
  workspaceCreate: "workspace.create",
  workspaceArchive: "workspace.archive",
  workspaceDelete: "workspace.delete",
  configSave: "config.save",
  metricDefine: "metric.define",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/**
 * Every HTTP write route that must produce an audit row today.
 * MCP write tools record `mcp.call` via recordMcpWriteAudit on /api/mcp.
 */
export const WRITE_HTTP_ROUTES = [
  { method: "POST", path: "/api/ingest/identify", action: AUDIT_ACTIONS.ingestIdentify },
  { method: "POST", path: "/api/ingest/event", action: AUDIT_ACTIONS.ingestEvent },
  { method: "POST", path: "/api/ingest/batch", action: AUDIT_ACTIONS.ingestBatch },
  { method: "POST", path: "/api/ingest/webhook/:source", action: AUDIT_ACTIONS.ingestWebhook },
  { method: "POST", path: "/api/v1/connect", action: AUDIT_ACTIONS.connectSave },
  { method: "POST", path: "/api/v1/import", action: AUDIT_ACTIONS.importCsv },
  { method: "POST", path: "/api/v1/sync", action: AUDIT_ACTIONS.syncTrigger },
  { method: "POST", path: "/api/v1/keys", action: AUDIT_ACTIONS.keysCreate },
  { method: "DELETE", path: "/api/v1/keys/:id", action: AUDIT_ACTIONS.keysRevoke },
  { method: "POST", path: "/api/v1/keys/downgrade", action: AUDIT_ACTIONS.keysDowngrade },
  { method: "POST", path: "/api/webhooks/stripe", action: AUDIT_ACTIONS.webhookStripe },
  { method: "POST", path: "/api/v1/outreach", action: AUDIT_ACTIONS.outreachQueue },
  { method: "POST", path: "/api/v1/outreach/approve", action: AUDIT_ACTIONS.outreachApprove },
  { method: "POST", path: "/api/v1/outreach/send", action: AUDIT_ACTIONS.outreachSend },
  { method: "POST", path: "/api/v1/outreach/outcome", action: AUDIT_ACTIONS.outreachOutcome },
  { method: "DELETE", path: "/api/v1/users/:id", action: AUDIT_ACTIONS.usersDelete },
  { method: "POST", path: "/api/v1/workspaces", action: AUDIT_ACTIONS.workspaceCreate },
  { method: "PATCH", path: "/api/v1/workspaces", action: AUDIT_ACTIONS.workspaceArchive },
  { method: "DELETE", path: "/api/v1/workspaces", action: AUDIT_ACTIONS.workspaceDelete },
  { method: "PATCH", path: "/api/v1/config", action: AUDIT_ACTIONS.configSave },
  { method: "POST", path: "/api/v1/metrics", action: AUDIT_ACTIONS.metricDefine },
] as const;

/** Route modules that perform writes (including the MCP mutation hook). */
export const WRITE_ROUTE_MODULES = [
  "src/app/api/ingest/identify/route.ts",
  "src/app/api/ingest/event/route.ts",
  "src/app/api/ingest/batch/route.ts",
  "src/app/api/ingest/webhook/[source]/route.ts",
  "src/app/api/v1/connect/route.ts",
  "src/app/api/v1/import/route.ts",
  "src/app/api/v1/sync/route.ts",
  "src/app/api/v1/keys/route.ts",
  "src/app/api/v1/keys/[id]/route.ts",
  "src/app/api/v1/keys/downgrade/route.ts",
  "src/app/api/webhooks/stripe/route.ts",
  "src/app/api/mcp/route.ts",
  "src/app/api/v1/users/[id]/route.ts",
  "src/app/api/v1/workspaces/route.ts",
  "src/app/api/v1/config/route.ts",
  "src/app/api/v1/metrics/route.ts",
] as const;

export type AuditEntry = {
  id: number;
  workspaceId: string;
  actor: string;
  action: string;
  subject: string;
  createdAt: Date;
};

export async function recordAudit(entry: {
  workspaceId: string;
  actor: string;
  action: string;
  subject: string;
  at?: Date;
}): Promise<void> {
  await db.insert(schema.auditLog).values({
    workspaceId: entry.workspaceId,
    actor: entry.actor,
    action: entry.action,
    subject: entry.subject,
    createdAt: entry.at ?? new Date(),
  });
}

export async function recordWriteAudit(
  auth: AuthOk,
  workspaceId: string,
  action: string,
  subject: string
): Promise<void> {
  await recordAudit({
    workspaceId,
    actor: actorFromAuth(auth),
    action,
    subject,
  });
}

export async function recordWebhookAudit(
  workspaceId: string,
  action: string,
  subject: string
): Promise<void> {
  await recordAudit({
    workspaceId,
    actor: AUDIT_ACTOR_WEBHOOK,
    action,
    subject,
  });
}

function mcpResultUnimplemented(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const content = (result as { content?: Array<{ text?: string }> }).content;
  const text = content?.[0]?.text ?? "";
  return /not implemented/i.test(text);
}

/** Record an MCP tools/call only when a write tool actually ran. */
export async function recordMcpWriteAudit(input: {
  auth: AuthOk;
  workspaceId: string;
  toolName: string | undefined;
  result: unknown;
}): Promise<void> {
  const name = input.toolName;
  if (!name || isReadOnlyMcpTool(name) || mcpResultUnimplemented(input.result)) {
    return;
  }
  await recordWriteAudit(input.auth, input.workspaceId, AUDIT_ACTIONS.mcpCall, name);
}

export type AuditListQuery = {
  workspaceId: string;
  actor?: string;
  action?: string;
  since?: Date;
  until?: Date;
  limit: number;
  offset: number;
};

export async function listAudit(query: AuditListQuery): Promise<{
  entries: AuditEntry[];
  total: number;
}> {
  const filters = [eq(schema.auditLog.workspaceId, query.workspaceId)];
  if (query.actor) filters.push(eq(schema.auditLog.actor, query.actor));
  if (query.action) filters.push(eq(schema.auditLog.action, query.action));
  if (query.since) filters.push(gte(schema.auditLog.createdAt, query.since));
  if (query.until) filters.push(lte(schema.auditLog.createdAt, query.until));

  const where = and(...filters);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.auditLog)
    .where(where)
    .all();

  const rows = await db
    .select()
    .from(schema.auditLog)
    .where(where)
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(query.limit)
    .offset(query.offset)
    .all();

  return {
    total: Number(countRow?.count ?? 0),
    entries: rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      actor: row.actor,
      action: row.action,
      subject: row.subject,
      createdAt: row.createdAt,
    })),
  };
}
