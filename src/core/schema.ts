import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

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
  date: integer("date", { mode: "timestamp" }).notNull(),
  coreCount: integer("core_count").default(0),
  searchCount: integer("search_count").default(0),
  shareCount: integer("share_count").default(0),
  payCount: integer("pay_count").default(0),
  minutes: integer("minutes").default(0),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  personDateIdx: index("activity_person_date_idx").on(table.personId, table.date),
  workspaceIdx: index("activity_workspace_idx").on(table.workspaceId),
}));

export const accounts = sqliteTable("accounts", {
  accountId: text("account_id").primaryKey(),
  name: text("name").notNull(),
  entity: text("entity"),
  activationState: text("activation_state"),
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
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  section: text("section").notNull(),
  type: text("type").notNull(),
  goodDirection: text("good_direction"),
  unit: text("unit"),
  decimals: integer("decimals").default(0),
  target: real("target"),
  sourceSpec: text("source_spec"),
  order: integer("order").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceOrderIdx: index("metric_defs_workspace_order_idx").on(table.workspaceId, table.order),
}));

export const metricPoints = sqliteTable("metric_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metricId: text("metric_id").notNull(),
  grain: text("grain").notNull(),
  period: text("period").notNull(),
  value: real("value"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  metricPeriodIdx: index("metric_points_metric_period_idx").on(table.metricId, table.period),
  workspaceIdx: index("metric_points_workspace_idx").on(table.workspaceId),
}));

export const calEvents = sqliteTable("cal_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  type: text("type").notNull(),
  date: integer("date", { mode: "timestamp" }).notNull(),
  title: text("title").notNull(),
  amount: real("amount"),
  badge: text("badge"),
  url: text("url"),
  externalId: text("external_id"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  dateIdx: index("cal_events_date_idx").on(table.date),
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
  connector: text("connector").primaryKey(),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  status: text("status").notNull(),
  error: text("error"),
  stats: text("stats"),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("sync_state_workspace_idx").on(table.workspaceId),
}));

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  hashedKey: text("hashed_key").notNull(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
});

export const config = sqliteTable("config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  workspaceId: text("workspace_id").notNull().default("demo"),
}, (table) => ({
  workspaceIdx: index("config_workspace_idx").on(table.workspaceId),
}));
