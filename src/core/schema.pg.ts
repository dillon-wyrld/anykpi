import { pgTable, text, integer, doublePrecision, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";

/**
 * Postgres mirror of `schema.ts`. sqlite-core stays the v0.x source of
 * truth; this file exists so drizzle-kit can emit `drizzle/pg` and so
 * the drift test can compare tables and columns. Storage stays close to
 * SQLite (unix-integer timestamps, 0/1 booleans) so a later query layer
 * can share contracts.
 */

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  archivedAt: integer("archived_at"),
});

export const users = pgTable("users", {
  personId: text("person_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  avatar: text("avatar"),
  emoji: text("emoji"),
  platform: text("platform"),
  country: text("country"),
  /** IANA timezone, e.g. America/Los_Angeles. Filled from real sources only. */
  timezone: text("timezone"),
  incomeBand: text("income_band"),
  traits: text("traits"),
  signupDate: integer("signup_date"),
  cluster: text("cluster"),
  accountId: text("account_id"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.personId] }),
  workspaceIdx: index("users_workspace_idx").on(table.workspaceId),
}));

export const activity = pgTable("activity", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  personId: text("person_id").notNull(),
  timestamp: integer("timestamp").notNull(),
  eventName: text("event_name").notNull(),
  eventClass: text("event_class").notNull(),
  platform: text("platform"),
  externalId: text("external_id"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  personTimestampIdx: index("activity_person_timestamp_idx").on(table.personId, table.timestamp),
  workspaceIdx: index("activity_workspace_idx").on(table.workspaceId),
  workspaceExternalUidx: uniqueIndex("activity_workspace_external_id_uidx").on(
    table.workspaceId,
    table.externalId
  ),
}));

export const accounts = pgTable("accounts", {
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  entity: text("entity"),
  seats: integer("seats").default(0),
  activated: integer("activated").default(0),
  mrr: doublePrecision("mrr").default(0),
  renewalDate: integer("renewal_date"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.accountId] }),
  workspaceIdx: index("accounts_workspace_idx").on(table.workspaceId),
}));

export const seats = pgTable("seats", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: text("account_id").notNull(),
  personId: text("person_id").notNull(),
  role: text("role"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  accountIdx: index("seats_account_idx").on(table.accountId),
  workspaceIdx: index("seats_workspace_idx").on(table.workspaceId),
}));

export const metricDefs = pgTable("metric_defs", {
  metricId: text("metric_id").notNull(),
  name: text("name").notNull(),
  section: text("section").notNull(),
  sectionOrder: text("section_order").notNull(),
  owner: text("owner").notNull(),
  type: text("type").notNull(),
  unit: text("unit"),
  target: doublePrecision("target"),
  goodDir: text("good_dir").notNull(),
  status: text("status").notNull(),
  statusReason: text("status_reason"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.metricId] }),
  workspaceIdx: index("metric_defs_workspace_idx").on(table.workspaceId),
}));

export const metricPoints = pgTable("metric_points", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  metricId: text("metric_id").notNull(),
  timestamp: integer("timestamp").notNull(),
  value: doublePrecision("value"),
  grain: text("grain").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  metricTimestampIdx: index("metric_points_metric_timestamp_idx").on(table.metricId, table.timestamp),
  workspaceIdx: index("metric_points_workspace_idx").on(table.workspaceId),
}));

export const calEvents = pgTable("cal_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  source: text("source").notNull(),
  sourceName: text("source_name").notNull(),
  sourceColor: text("source_color").notNull(),
  type: text("type").notNull(),
  emoji: text("emoji").notNull(),
  title: text("title").notNull(),
  badge: text("badge").notNull(),
  eventDate: integer("event_date").notNull(),
  isFuture: integer("is_future").default(0),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  dateIdx: index("cal_events_date_idx").on(table.eventDate),
  workspaceIdx: index("cal_events_workspace_idx").on(table.workspaceId),
}));

export const annotations = pgTable("annotations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  type: text("type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  targetIdx: index("annotations_target_idx").on(table.targetType, table.targetId),
  workspaceIdx: index("annotations_workspace_idx").on(table.workspaceId),
}));

export const syncState = pgTable("sync_state", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  source: text("source").notNull(),
  sourceName: text("source_name").notNull(),
  lastSync: integer("last_sync"),
  status: text("status").notNull(),
  error: text("error"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("sync_state_workspace_idx").on(table.workspaceId),
  workspaceSourceUidx: uniqueIndex("sync_state_workspace_source_uidx").on(
    table.workspaceId,
    table.source
  ),
}));

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  hashedKey: text("hashed_key").notNull(),
  name: text("name").notNull(),
  workspaceId: text("workspace_id").notNull().default("live"),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
  scope: text("scope").notNull().default("write"),
  legacy: integer("legacy").notNull().default(1),
});

export const config = pgTable("config", {
  key: text("key").notNull(),
  value: text("value").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.key] }),
  workspaceIdx: index("config_workspace_idx").on(table.workspaceId),
}));

export const mrrSnapshots = pgTable("mrr_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  period: integer("period").notNull(),
  grain: text("grain").notNull(),
  mrr: doublePrecision("mrr").notNull(),
  subscriberCount: integer("subscriber_count").notNull().default(0),
  source: text("source").notNull().default("demo"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("mrr_snapshots_workspace_idx").on(table.workspaceId),
  workspaceGrainPeriodUidx: uniqueIndex("mrr_snapshots_workspace_grain_period_uidx").on(
    table.workspaceId,
    table.grain,
    table.period
  ),
}));

export const subscriptionEvents = pgTable("subscription_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  personId: text("person_id").notNull(),
  accountId: text("account_id"),
  eventType: text("event_type").notNull(),
  occurredAt: integer("occurred_at").notNull(),
  mrrDelta: doublePrecision("mrr_delta").notNull().default(0),
  plan: text("plan"),
  source: text("source").notNull().default("demo"),
  sourceEventId: text("source_event_id").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("subscription_events_workspace_idx").on(table.workspaceId),
  personIdx: index("subscription_events_person_idx").on(table.personId),
  occurredIdx: index("subscription_events_occurred_idx").on(table.occurredAt),
  workspaceSourceEventUidx: uniqueIndex("subscription_events_workspace_source_event_uidx").on(
    table.workspaceId,
    table.source,
    table.sourceEventId
  ),
}));

export const personRevenue = pgTable("person_revenue", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  personId: text("person_id").notNull(),
  accountId: text("account_id"),
  status: text("status").notNull(),
  plan: text("plan"),
  mrr: doublePrecision("mrr").notNull().default(0),
  ltv: doublePrecision("ltv").notNull().default(0),
  firstPaidAt: integer("first_paid_at"),
  lastChargeAt: integer("last_charge_at"),
  chargeCount: integer("charge_count").notNull().default(0),
  lastChargeAmount: doublePrecision("last_charge_amount"),
  currency: text("currency").notNull().default("usd"),
  source: text("source").notNull().default("demo"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("person_revenue_workspace_idx").on(table.workspaceId),
  workspacePersonUidx: uniqueIndex("person_revenue_workspace_person_uidx").on(
    table.workspaceId,
    table.personId
  ),
}));

export const sources = pgTable("sources", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: text("workspace_id").notNull().default("live"),
  source: text("source").notNull(),
  config: text("config").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  /** Set when the operator pauses scheduling. Credentials stay. */
  pausedAt: integer("paused_at"),
}, (table) => ({
  workspaceIdx: index("sources_workspace_idx").on(table.workspaceId),
  workspaceSourceUidx: uniqueIndex("sources_workspace_source_uidx").on(
    table.workspaceId,
    table.source
  ),
}));

export const auditLog = pgTable("audit_log", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: text("workspace_id").notNull().default("live"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  subject: text("subject").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => ({
  workspaceCreatedIdx: index("audit_log_workspace_created_idx").on(
    table.workspaceId,
    table.createdAt
  ),
  workspaceActorCreatedIdx: index("audit_log_workspace_actor_created_idx").on(
    table.workspaceId,
    table.actor,
    table.createdAt
  ),
}));

export const outreach = pgTable("outreach", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default("live"),
  personId: text("person_id").notNull(),
  body: text("body").notNull(),
  state: text("state").notNull().default("waiting"),
  approvedBy: text("approved_by"),
  createdAt: integer("created_at").notNull(),
  approvedAt: integer("approved_at"),
  sentAt: integer("sent_at"),
}, (table) => ({
  workspaceIdx: index("outreach_workspace_idx").on(table.workspaceId),
  workspacePersonIdx: index("outreach_workspace_person_idx").on(
    table.workspaceId,
    table.personId
  ),
  workspaceStateIdx: index("outreach_workspace_state_idx").on(
    table.workspaceId,
    table.state
  ),
}));

export const outreachDelivery = pgTable("outreach_delivery", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  outreachId: text("outreach_id").notNull(),
  workspaceId: text("workspace_id").notNull().default("live"),
  recipient: text("recipient").notNull(),
  approvedBy: text("approved_by").notNull(),
  sentAt: integer("sent_at").notNull(),
}, (table) => ({
  workspaceSentIdx: index("outreach_delivery_workspace_sent_idx").on(
    table.workspaceId,
    table.sentAt
  ),
  outreachIdx: index("outreach_delivery_outreach_idx").on(table.outreachId),
}));

export const tombstones = pgTable("tombstones", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: text("workspace_id").notNull(),
  externalId: text("external_id").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => ({
  workspaceIdx: index("tombstones_workspace_idx").on(table.workspaceId),
  workspaceExternalUidx: uniqueIndex("tombstones_workspace_external_uidx").on(
    table.workspaceId,
    table.externalId
  ),
}));

export const balanceSnapshots = pgTable("balance_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  asOf: integer("as_of").notNull(),
  cashBalance: doublePrecision("cash_balance").notNull(),
  monthlyBurn: doublePrecision("monthly_burn").notNull(),
  runwayMonths: doublePrecision("runway_months").notNull(),
  source: text("source").notNull().default("demo"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("balance_snapshots_workspace_idx").on(table.workspaceId),
  workspaceAsOfUidx: uniqueIndex("balance_snapshots_workspace_as_of_uidx").on(
    table.workspaceId,
    table.asOf
  ),
}));
