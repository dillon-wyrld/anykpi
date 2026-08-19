import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  personId: text("person_id").primaryKey(),
  name: text("name").notNull(),
  email: text("email"),
  avatar: text("avatar"),
  emoji: text("emoji"),
  platform: text("platform"),
  country: text("country"),
  incomeBand: text("income_band"),
  traits: text("traits"),
  signupDate: integer("signup_date", { mode: "timestamp" }),
  cluster: text("cluster"),
  accountId: text("account_id"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("users_workspace_idx").on(table.workspaceId),
}));

export const activity = sqliteTable("activity", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  personId: text("person_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  eventName: text("event_name").notNull(),
  eventClass: text("event_class").notNull(), // core, search, share, pay
  platform: text("platform"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  personTimestampIdx: index("activity_person_timestamp_idx").on(table.personId, table.timestamp),
  workspaceIdx: index("activity_workspace_idx").on(table.workspaceId),
}));

export const accounts = sqliteTable("accounts", {
  accountId: text("account_id").primaryKey(),
  name: text("name").notNull(),
  entity: text("entity"),
  seats: integer("seats").default(0),
  activated: integer("activated").default(0),
  mrr: real("mrr").default(0),
  renewalDate: integer("renewal_date", { mode: "timestamp" }),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
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
  metricId: text("metric_id").primaryKey(),
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
});

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("config_workspace_idx").on(table.workspaceId),
  keyWorkspaceUidx: uniqueIndex("config_key_workspace_uidx").on(
    table.key,
    table.workspaceId
  ),
}));
