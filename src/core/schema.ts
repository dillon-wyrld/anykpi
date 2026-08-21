import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

/**
 * SQLite schema — source of truth through v0.x.
 * `schema.pg.ts` is the Postgres mirror. The schema-drift test asserts
 * both declare the same tables and columns. Add columns here first,
 * then mirror them.
 */

/**
 * Named workspaces. Isolation is the composite (workspace_id, id) on
 * users / accounts / metric_defs / config — this table is the catalog
 * the dashboard switcher and key minting read.
 */
export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
});

export const users = sqliteTable("users", {
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
  signupDate: integer("signup_date", { mode: "timestamp" }),
  cluster: text("cluster"),
  accountId: text("account_id"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.personId] }),
  workspaceIdx: index("users_workspace_idx").on(table.workspaceId),
}));

export const activity = sqliteTable("activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: text("person_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  eventName: text("event_name").notNull(),
  eventClass: text("event_class").notNull(), // core, search, share, pay
  platform: text("platform"),
  /**
   * Stable event identity. Unique with workspaceId so CSV import,
   * connectors, and later ingest paths can retry without duplicates.
   */
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

export const accounts = sqliteTable("accounts", {
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  entity: text("entity"),
  seats: integer("seats").default(0),
  activated: integer("activated").default(0),
  mrr: real("mrr").default(0),
  renewalDate: integer("renewal_date", { mode: "timestamp" }),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.accountId] }),
  workspaceIdx: index("accounts_workspace_idx").on(table.workspaceId),
}));

export const seats = sqliteTable("seats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(),
  personId: text("person_id").notNull(),
  role: text("role"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  accountIdx: index("seats_account_idx").on(table.accountId),
  workspaceIdx: index("seats_workspace_idx").on(table.workspaceId),
}));

export const metricDefs = sqliteTable("metric_defs", {
  metricId: text("metric_id").notNull(),
  name: text("name").notNull(),
  section: text("section").notNull(),
  sectionOrder: text("section_order").notNull(),
  owner: text("owner").notNull(),
  type: text("type").notNull(),
  unit: text("unit"),
  target: real("target"),
  goodDir: text("good_dir").notNull(), // "up" or "down"
  status: text("status").notNull(), // "ok", "watch", "off"
  statusReason: text("status_reason"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.metricId] }),
  workspaceIdx: index("metric_defs_workspace_idx").on(table.workspaceId),
}));

export const metricPoints = sqliteTable("metric_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metricId: text("metric_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  value: real("value"),
  grain: text("grain").notNull(), // "week" or "month"
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  metricTimestampIdx: index("metric_points_metric_timestamp_idx").on(table.metricId, table.timestamp),
  workspaceIdx: index("metric_points_workspace_idx").on(table.workspaceId),
}));

export const calEvents = sqliteTable("cal_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  sourceName: text("source_name").notNull(),
  sourceColor: text("source_color").notNull(),
  type: text("type").notNull(), // launch, ritual, milestone, comms
  emoji: text("emoji").notNull(),
  title: text("title").notNull(),
  badge: text("badge").notNull(),
  eventDate: integer("event_date", { mode: "timestamp" }).notNull(),
  isFuture: integer("is_future", { mode: "boolean" }).default(false),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  dateIdx: index("cal_events_date_idx").on(table.eventDate),
  workspaceIdx: index("cal_events_workspace_idx").on(table.workspaceId),
}));

export const annotations = sqliteTable("annotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  targetIdx: index("annotations_target_idx").on(table.targetType, table.targetId),
  workspaceIdx: index("annotations_workspace_idx").on(table.workspaceId),
}));

export const syncState = sqliteTable("sync_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  sourceName: text("source_name").notNull(),
  lastSync: integer("last_sync", { mode: "timestamp" }),
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

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  hashedKey: text("hashed_key").notNull(),
  name: text("name").notNull(),
  workspaceId: text("workspace_id").notNull().default("live"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  /**
   * Existing rows migrate to write (see 0005). New keys are inserted as
   * read unless the caller asks for write or admin.
   */
  scope: text("scope").notNull().default("write"),
  /** True for keys that existed before named scopes shipped. */
  legacy: integer("legacy", { mode: "boolean" }).notNull().default(true),
});

export const config = sqliteTable("config", {
  key: text("key").notNull(),
  value: text("value").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  pk: primaryKey({ columns: [table.workspaceId, table.key] }),
  workspaceIdx: index("config_workspace_idx").on(table.workspaceId),
}));

/**
 * Weekly / monthly MRR snapshots. Stripe and RevenueCat write the same
 * rows later; views read this table now from demo seed.
 */
export const mrrSnapshots = sqliteTable("mrr_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  period: integer("period", { mode: "timestamp" }).notNull(),
  grain: text("grain").notNull(), // week | month
  mrr: real("mrr").notNull(),
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

/** New / churned / renewed subscription events. Idempotent on source event id. */
export const subscriptionEvents = sqliteTable("subscription_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: text("person_id").notNull(),
  accountId: text("account_id"),
  eventType: text("event_type").notNull(), // new | churned | renewed | upgraded | downgraded
  occurredAt: integer("occurred_at", { mode: "timestamp" }).notNull(),
  mrrDelta: real("mrr_delta").notNull().default(0),
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

/** Per-person revenue join — current plan / MRR / summarized charges. */
export const personRevenue = sqliteTable("person_revenue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: text("person_id").notNull(),
  accountId: text("account_id"),
  status: text("status").notNull(), // active | churned | trial | free
  plan: text("plan"),
  mrr: real("mrr").notNull().default(0),
  ltv: real("ltv").notNull().default(0),
  firstPaidAt: integer("first_paid_at", { mode: "timestamp" }),
  lastChargeAt: integer("last_charge_at", { mode: "timestamp" }),
  chargeCount: integer("charge_count").notNull().default(0),
  lastChargeAmount: real("last_charge_amount"),
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

/**
 * Per-source connector config. `config` is ciphertext (AES-256-GCM)
 * sealed with ANYKPI_SECRET. Never store plaintext credentials.
 */
export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("live"),
  source: text("source").notNull(),
  config: text("config").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  /** Set when the operator pauses scheduling. Credentials stay. */
  pausedAt: integer("paused_at", { mode: "timestamp" }),
}, (table) => ({
  workspaceIdx: index("sources_workspace_idx").on(table.workspaceId),
  workspaceSourceUidx: uniqueIndex("sources_workspace_source_uidx").on(
    table.workspaceId,
    table.source
  ),
}));

/**
 * Append-only action log. Every keyed write (ingest, config, keys, sync,
 * MCP mutation) records actor + action + subject + timestamp so a founder
 * can ask what an agent did.
 */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull().default("live"),
  /** Key id, `env`, or `session`. HMAC inbound writes use `webhook`. */
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  subject: text("subject").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
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

/**
 * Persisted PMF+ outreach draft. Delivery is structurally gated on
 * `state = approved` plus `approved_by` — there is no send path that
 * accepts a client-only draft.
 */
export const outreach = sqliteTable("outreach", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().default("live"),
  personId: text("person_id").notNull(),
  body: text("body").notNull(),
  /** waiting | approved | sent */
  state: text("state").notNull().default("waiting"),
  approvedBy: text("approved_by"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  sentAt: integer("sent_at", { mode: "timestamp" }),
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

/**
 * Append-only send log. One row per successful delivery: timestamp,
 * recipient, and the actor who approved the draft.
 */
export const outreachDelivery = sqliteTable("outreach_delivery", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  outreachId: text("outreach_id").notNull(),
  workspaceId: text("workspace_id").notNull().default("live"),
  recipient: text("recipient").notNull(),
  approvedBy: text("approved_by").notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
  workspaceSentIdx: index("outreach_delivery_workspace_sent_idx").on(
    table.workspaceId,
    table.sentAt
  ),
  outreachIdx: index("outreach_delivery_outreach_idx").on(table.outreachId),
}));

/**
 * GDPR tombstone. A deleted person's workspace + external ids stay here
 * so connector upserts, CSV import, and ingest cannot resurrect them.
 */
export const tombstones = sqliteTable("tombstones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workspaceId: text("workspace_id").notNull(),
  /** personId, source user id, email, or account id that must not return. */
  externalId: text("external_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
  workspaceIdx: index("tombstones_workspace_idx").on(table.workspaceId),
  workspaceExternalUidx: uniqueIndex("tombstones_workspace_external_uidx").on(
    table.workspaceId,
    table.externalId
  ),
}));

/** Cash balance and runway. Banking connectors fill this later. */
export const balanceSnapshots = sqliteTable("balance_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  asOf: integer("as_of", { mode: "timestamp" }).notNull(),
  cashBalance: real("cash_balance").notNull(),
  monthlyBurn: real("monthly_burn").notNull(),
  runwayMonths: real("runway_months").notNull(),
  source: text("source").notNull().default("demo"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("balance_snapshots_workspace_idx").on(table.workspaceId),
  workspaceAsOfUidx: uniqueIndex("balance_snapshots_workspace_as_of_uidx").on(
    table.workspaceId,
    table.asOf
  ),
}));
