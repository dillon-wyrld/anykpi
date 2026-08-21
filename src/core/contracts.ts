/**
 * Zod Contracts - Shared by UI, REST API, and MCP
 * 
 * These schemas define the canonical resource shape.
 * OpenAPI is generated from these contracts.
 */

import { z } from 'zod';

// ========== Core Resources ==========

export const UserSchema = z.object({
  personId: z.string(),
  name: z.string(),
  email: z.string().email().optional(),
  emoji: z.string().optional(),
  platform: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  signupDate: z.string().datetime().optional(),
  cluster: z.string().optional(),
  accountId: z.string().optional(),
  workspaceId: z.string(),
});

export const ActivityEventSchema = z.object({
  id: z.number(),
  personId: z.string(),
  timestamp: z.string().datetime(),
  eventName: z.string(),
  eventClass: z.enum(['core', 'search', 'share', 'pay']),
  platform: z.string().optional(),
  externalId: z.string().optional(),
  workspaceId: z.string(),
});

export const CohortSchema = z.object({
  cohort: z.string(),
  label: z.string(),
  size: z.number(),
  weeks: z.array(z.number()),
  smileDetected: z.boolean(),
  retention: z.object({
    week0: z.number(),
    week4: z.number(),
    latest: z.number(),
  }),
});

export const WBRMetricSchema = z.object({
  id: z.string(),
  name: z.string(),
  section: z.string(),
  sectionOrder: z.string(),
  owner: z.string(),
  type: z.enum(['input', 'output']),
  unit: z.string(),
  target: z.number(),
  current: z.number(),
  wow: z.number(),
  yoy: z.number(),
  status: z.enum(['ok', 'watch', 'off']),
  statusReason: z.string().optional(),
  source: z.string(),
  syncAge: z.string(),
  lifecycle: z.enum(['proposal', 'active', 'retired']).optional(),
  goodDir: z.number().optional(),
  sourceKind: z.enum(['event_count', 'revenue', 'manual', 'read_model']).optional(),
});

export const CalendarEventSchema = z.object({
  id: z.number(),
  source: z.string(),
  sourceName: z.string(),
  sourceColor: z.string(),
  type: z.enum(['launch', 'ritual', 'milestone', 'comms']),
  emoji: z.string(),
  title: z.string(),
  badge: z.string(),
  date: z.string().datetime(),
  isFuture: z.boolean(),
  syncAge: z.string().optional(),
  syncStatus: z.string().optional(),
});

export const SyncStateSchema = z.object({
  source: z.string(),
  sourceName: z.string(),
  lastSync: z.string().datetime().optional(),
  status: z.enum(['success', 'error', 'pending']),
  error: z.string().optional(),
  paused: z.boolean().optional(),
});

/** Connector health on get_overview / GET /api/v1/overview. */
export const SyncHealthSchema = z.object({
  source: z.string(),
  sourceName: z.string(),
  status: z.enum(['success', 'error', 'pending']),
  lastSynced: z.string().datetime().optional(),
  error: z.string().optional(),
  paused: z.boolean().optional(),
});

/**
 * Per-city online tallies. Summaries only — never a person id or
 * per-person online flag. Online is real activity in the trailing
 * hour as of `asOf` (last data), not a simulated presence.
 */
export const PresenceCitySchema = z.object({
  city: z.string(),
  country: z.string(),
  timezone: z.string(),
  users: z.number().int().nonnegative(),
  online: z.number().int().nonnegative(),
  cameOnline: z.number().int().nonnegative(),
  droppedOff: z.number().int().nonnegative(),
  home: z.boolean(),
});

export const PresenceSchema = z.object({
  asOf: z.string().datetime().nullable(),
  online: z.number().int().nonnegative(),
  cameOnline: z.number().int().nonnegative(),
  droppedOff: z.number().int().nonnegative(),
  unplaced: z.number().int().nonnegative(),
  unplacedOnline: z.number().int().nonnegative(),
  cities: z.array(PresenceCitySchema),
});

/**
 * One connector sync attempt. Cursor and health rules are documented on
 * `Connector` in `src/connectors/index.ts` (incremental / scheduled sync).
 */
export const ConnectorHealthSchema = z.enum(['ok', 'degraded', 'error']);

export const SyncResultSchema = z.object({
  rowsSynced: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  health: ConnectorHealthSchema,
  error: z.string().optional(),
});

export const AccountSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  seats: z.number(),
  activated: z.number(),
  mrr: z.number(),
  workspaceId: z.string(),
});

export const MrrSnapshotSchema = z.object({
  id: z.number().int().optional(),
  period: z.string().datetime(),
  grain: z.enum(['week', 'month']),
  mrr: z.number(),
  subscriberCount: z.number().int().nonnegative(),
  source: z.string(),
  workspaceId: z.string(),
});

export const SubscriptionEventTypeSchema = z.enum([
  'new',
  'churned',
  'renewed',
  'upgraded',
  'downgraded',
]);

export const SubscriptionEventSchema = z.object({
  id: z.number().int().optional(),
  personId: z.string(),
  accountId: z.string().nullable().optional(),
  eventType: SubscriptionEventTypeSchema,
  occurredAt: z.string().datetime(),
  mrrDelta: z.number(),
  plan: z.string().nullable().optional(),
  source: z.string(),
  sourceEventId: z.string(),
  workspaceId: z.string(),
});

export const PersonRevenueStatusSchema = z.enum(['active', 'churned', 'trial', 'free']);

export const PersonRevenueSchema = z.object({
  id: z.number().int().optional(),
  personId: z.string(),
  accountId: z.string().nullable().optional(),
  status: PersonRevenueStatusSchema,
  plan: z.string().nullable().optional(),
  mrr: z.number(),
  ltv: z.number(),
  firstPaidAt: z.string().datetime().nullable().optional(),
  lastChargeAt: z.string().datetime().nullable().optional(),
  chargeCount: z.number().int().nonnegative(),
  lastChargeAmount: z.number().nullable().optional(),
  currency: z.string(),
  source: z.string(),
  workspaceId: z.string(),
});

export const BalanceSnapshotSchema = z.object({
  id: z.number().int().optional(),
  asOf: z.string().datetime(),
  cashBalance: z.number(),
  monthlyBurn: z.number(),
  runwayMonths: z.number(),
  source: z.string(),
  workspaceId: z.string(),
});

/**
 * Summarized person-level revenue ANY-20 reads. Charge detail is rolled up —
 * never a raw charge dump.
 */
export const PersonRevenueBlockSchema = z.object({
  personId: z.string(),
  workspaceId: z.string(),
  isPayer: z.boolean(),
  status: PersonRevenueStatusSchema,
  plan: z.string().nullable(),
  mrr: z.number(),
  ltv: z.number(),
  currency: z.string(),
  firstPaidAt: z.string().datetime().nullable(),
  charges: z.object({
    count: z.number().int().nonnegative(),
    total: z.number(),
    lastAmount: z.number().nullable(),
    lastAt: z.string().datetime().nullable(),
  }),
  subscription: z.object({
    eventCount: z.number().int().nonnegative(),
    startedAt: z.string().datetime().nullable(),
    canceledAt: z.string().datetime().nullable(),
  }),
});

export const PersonTimelineEventSchema = z.object({
  id: z.number(),
  timestamp: z.string().datetime(),
  eventName: z.string(),
  eventClass: z.enum(['core', 'search', 'share', 'pay']),
  platform: z.string().optional(),
});

export const PersonPanelResponseSchema = z.object({
  personId: z.string(),
  name: z.string(),
  emoji: z.string().nullable(),
  platform: z.string().nullable(),
  country: z.string().nullable(),
  cluster: z.string().nullable(),
  cohort: z.string().nullable(),
  firstSeen: z.string().datetime().nullable(),
  lastSeen: z.string().datetime().nullable(),
  events: z.array(PersonTimelineEventSchema),
  revenue: PersonRevenueBlockSchema,
  workspace: z.string(),
});

// ========== API Responses ==========

export const TodayMilestoneSchema = z.object({
  key: z.string(),
  kind: z.literal("company_day"),
  subject: z.string(),
  title: z.string(),
  source: z.string(),
  occurredAt: z.string().datetime(),
});

export const OverviewResponseSchema = z.object({
  workspace: z.string(),
  dayN: z.number().int().nonnegative(),
  weekN: z.number().int().positive(),
  timeLeftToday: z.string(),
  nextMilestone: z.number().int().positive(),
  todayMilestone: TodayMilestoneSchema.nullable(),
  totalUsers: z.number(),
  activeToday: z.number(),
  weeklyActive: z.number(),
  retentionRate: z.number(),
  smileDetected: z.boolean(),
  exceptionsCount: z.number(),
  upcomingEvents: z.number(),
  syncHealth: z.array(SyncHealthSchema),
  presence: PresenceSchema,
  view_url: z.string().optional(),
});

export const UsersListResponseSchema = z.object({
  users: z.array(UserSchema),
  total: z.number(),
  hasMore: z.boolean(),
  nextOffset: z.number().int().nullable(),
  workspace: z.string(),
  view_url: z.string().optional(),
});

export const DeleteUserResponseSchema = z.object({
  deleted: z.literal(true),
  personId: z.string(),
  workspace: z.string(),
});

export const CohortCompareSeriesSchema = z.object({
  key: z.string(),
  size: z.number().int().nonnegative(),
  cohorts: z.array(CohortSchema),
});

export const CohortsResponseSchema = z.object({
  cohorts: z.array(CohortSchema),
  smileDetected: z.boolean(),
  workspace: z.string(),
  view_url: z.string().optional(),
  split: z.enum(["platform", "country", "cluster"]).nullable().optional(),
  series: z.array(CohortCompareSeriesSchema).max(3).optional(),
});

export const WBRResponseSchema = z.object({
  metrics: z.array(WBRMetricSchema),
  proposals: z.array(WBRMetricSchema).optional(),
  sections: z.array(z.string()),
  exceptionsCount: z.number(),
  workspace: z.string(),
  view_url: z.string().optional(),
});

export const CalendarResponseSchema = z.object({
  events: z.array(CalendarEventSchema),
  sources: z.array(z.string()),
  workspace: z.string(),
  view_url: z.string().optional(),
});

export const SyncResponseSchema = z.object({
  states: z.array(SyncStateSchema),
  workspace: z.string(),
  /** Minutes between in-process pulls. 0 means the scheduler is off. */
  syncIntervalMinutes: z.number().int().nonnegative(),
});

/** Lightweight poll payload: last ingest + per-source last-sync stamps. */
export const FreshnessSourceSchema = z.object({
  source: z.string(),
  lastSync: z.string().datetime().nullable(),
});

export const FreshnessResponseSchema = z.object({
  workspace: z.string(),
  /** Highest activity id plus that row's event time — moves on every insert. */
  lastIngest: z.string().nullable(),
  sources: z.array(FreshnessSourceSchema),
});

/**
 * User×day matrix row — the same derived fields `buildDotPlotUsers`
 * puts on each person the dashboard reads.
 */
export const ActivityMatrixUserSchema = z
  .object({
    personId: z.string(),
    activity: z.array(z.boolean()),
    signupOffset: z.number().int(),
    cohortMonth: z.number().int(),
    activeCount: z.number().int().nonnegative(),
    streak: z.number().int().nonnegative(),
    lastSeen: z.number().int(),
    isNew: z.boolean(),
    paid: z.boolean(),
    churned: z.boolean(),
  })
  .passthrough();

/** MCP `get_activity` — same matrix as `/api/views/dotplot`. */
export const ActivityResponseSchema = z.object({
  users: z.array(ActivityMatrixUserSchema),
  days: z.number().int().positive(),
  baseDate: z.string().datetime(),
  workspace: z.string().optional(),
  viewUrl: z.string().optional(),
  view_url: z.string().optional(),
});

/**
 * MCP `get_sync_status` — freshness stamps plus GET /api/v1/sync state.
 */
export const SyncStatusResponseSchema = FreshnessResponseSchema.merge(
  SyncResponseSchema
).extend({
  viewUrl: z.string().optional(),
  view_url: z.string().optional(),
});

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    enum?: string[];
  };
};

const workspaceInput = {
  workspace: {
    type: "string",
    description: "Workspace ID (default: demo)",
  },
} as const;

/** Shared tool ads for stdio and HTTP MCP. */
export const MCP_GET_ACTIVITY_TOOL: McpToolDefinition = {
  name: "get_activity",
  description:
    "Get the user×day activity matrix the dashboard reads. Returns users with per-day activity plus view_url",
  inputSchema: {
    type: "object",
    properties: { ...workspaceInput },
  },
};

export const MCP_GET_SYNC_STATUS_TOOL: McpToolDefinition = {
  name: "get_sync_status",
  description:
    "Get connector freshness and sync state (last ingest, per-source last-sync, interval). Returns the same stamps as GET /api/v1/freshness and GET /api/v1/sync plus view_url",
  inputSchema: {
    type: "object",
    properties: { ...workspaceInput },
  },
};

/**
 * Event-count / revenue / manual source for a WBR metric.
 * Status is computed — it is not part of the source.
 */
export const MetricSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("event_count"),
    measure: z.enum(["signups", "actives", "retention", "events"]).optional(),
    eventName: z.string().min(1).max(200).optional(),
    filters: z
      .object({
        platform: z.string().min(1).max(40).optional(),
        country: z.string().min(1).max(8).optional(),
        eventClass: z.enum(["core", "search", "share", "pay"]).optional(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal("revenue"),
    series: z.enum(["mrr", "new", "churned", "arpu", "runway"]),
  }),
  z.object({
    kind: z.literal("manual"),
  }),
]);

export const MetricPointInputSchema = z.object({
  timestamp: z.string().datetime(),
  value: z.number(),
  grain: z.enum(["week", "month"]).default("week"),
});

/**
 * Create or update a WBR metric. Same body for REST and MCP `define_metric`.
 * Status is computed from the series — write paths refuse it.
 */
export const DefineMetricRequestSchema = z
  .object({
    id: z.string().min(1).max(80).optional(),
    name: z.string().min(1).max(80),
    section: z.enum(["fin", "acq", "act", "eng", "qua"]),
    type: z.enum(["input", "output"]),
    unit: z.string().max(8).optional(),
    target: z.number().optional(),
    goodDir: z.enum(["up", "down"]).optional(),
    owner: z.string().min(1).max(16).optional(),
    source: MetricSourceSchema,
    points: z.array(MetricPointInputSchema).max(200).optional(),
    workspace: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .strict();

export const DefineMetricResponseSchema = z.object({
  metric: z.object({
    id: z.string(),
    name: z.string(),
    section: z.string(),
    sectionOrder: z.string(),
    owner: z.string(),
    type: z.enum(["input", "output"]),
    unit: z.string(),
    target: z.number(),
    goodDir: z.enum(["up", "down"]),
    source: MetricSourceSchema,
    lifecycle: z.enum(["proposal", "active", "retired"]),
  }),
  workspace: z.string(),
  view_url: z.string().optional(),
  viewUrl: z.string().optional(),
});

export const MetricDefinePatchSchema = DefineMetricRequestSchema.extend({
  action: z.literal("define"),
});

export const MetricAcceptRequestSchema = z
  .object({
    action: z.literal("accept"),
    ids: z.array(z.string().min(1).max(80)).max(32).optional(),
    workspace: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .strict();

export const MetricRetireRequestSchema = z
  .object({
    action: z.literal("retire"),
    id: z.string().min(1).max(80),
    workspace: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .strict();

export const MetricReorderRequestSchema = z
  .object({
    action: z.literal("reorder"),
    order: z.array(z.string().min(1).max(80)).min(1).max(64),
    workspace: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .strict();

export const MetricEditRequestSchema = z
  .object({
    action: z.literal("edit"),
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(80).optional(),
    section: z.enum(["fin", "acq", "act", "eng", "qua"]).optional(),
    type: z.enum(["input", "output"]).optional(),
    unit: z.string().max(8).optional(),
    target: z.number().optional(),
    goodDir: z.enum(["up", "down"]).optional(),
    owner: z.string().min(1).max(16).optional(),
    source: MetricSourceSchema.optional(),
    workspace: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .strict();

export const MetricImportRequestSchema = z
  .object({
    action: z.literal("import"),
    id: z.string().min(1).max(80),
    csv: z.string().min(1).max(200_000),
    workspace: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .strict();

export const MetricPatchRequestSchema = z.discriminatedUnion("action", [
  MetricDefinePatchSchema,
  MetricAcceptRequestSchema,
  MetricRetireRequestSchema,
  MetricReorderRequestSchema,
  MetricEditRequestSchema,
  MetricImportRequestSchema,
]);

export const MetricMutationResponseSchema = z.object({
  ok: z.literal(true),
  workspace: z.string(),
  ids: z.array(z.string()).optional(),
  imported: z.number().int().nonnegative().optional(),
  updated: z.number().int().nonnegative().optional(),
  view_url: z.string().optional(),
  viewUrl: z.string().optional(),
});

export const MCP_DEFINE_METRIC_TOOL: McpToolDefinition = {
  name: "define_metric",
  description:
    "Create or update a WBR metric (name, section, input/output, unit, target, direction, source). Status is computed and cannot be written. Requires a write-scoped API key. Returns the metric plus view_url.",
  inputSchema: {
    type: "object",
    properties: {
      workspace: {
        type: "string",
        description: "Workspace ID (default: live)",
      },
      id: {
        type: "string",
        description: "Metric id. Generated from the name when omitted.",
      },
      name: {
        type: "string",
        description: "Display name",
      },
      section: {
        type: "string",
        description: "Deck section: fin, acq, act, eng, or qua",
      },
      type: {
        type: "string",
        description: "input or output",
      },
      unit: {
        type: "string",
        description: "Display unit ($ , %, or empty)",
      },
      target: {
        type: "number",
        description: "Target value. Changing it does not rewrite history.",
      },
      goodDir: {
        type: "string",
        description: "up or down",
      },
      owner: {
        type: "string",
        description: "Short owner mark on the card",
      },
      source: {
        type: "object",
        description:
          "event_count (optional event name + filters), revenue series, or manual/CSV",
      },
      points: {
        type: "array",
        description: "Optional manual points (timestamp, value, grain)",
      },
    },
  },
};

/**
 * Floor of the v1 MCP surface. tools/list may grow; a missing name is drift.
 * Shared read/write tools that both HTTP and stdio advertise.
 */
export const PINNED_MCP_TOOLS = [
  "get_overview",
  "query_users",
  "get_activity",
  "get_cohorts",
  "get_wbr",
  "get_calendar",
  "get_sync_status",
  "connect_source",
  "trigger_sync",
  "import_csv",
  "define_metric",
  "disconnect_source",
] as const;

/** Stdio also advertises SDK install and value-event mapping. */
export const PINNED_STDIO_MCP_TOOLS = [
  ...PINNED_MCP_TOOLS,
  "install_sdk",
  "configure_value_events",
] as const;

/** HTTP also advertises outreach queue / approve / send. */
export const PINNED_HTTP_MCP_TOOLS = [
  ...PINNED_MCP_TOOLS,
  "queue_outreach",
  "approve_outreach",
  "send_outreach",
] as const;

/** Names in `pinned` that are absent from `listed`. Empty means no shrink. */
export function missingPinnedMcpTools(
  listed: readonly string[],
  pinned: readonly string[]
): string[] {
  const have = new Set(listed);
  return pinned.filter((name) => !have.has(name));
}

export const SyncTriggerRequestSchema = z.object({
  source: z.string().optional(),
  workspace: z.string().optional(),
});

export const SyncTriggerResultSchema = SyncResultSchema.extend({
  source: z.string(),
});

export const SyncTriggerResponseSchema = z.object({
  results: z.array(SyncTriggerResultSchema),
  states: z.array(SyncStateSchema),
  workspace: z.string(),
});

// ========== API Requests ==========

export const QueryUsersRequestSchema = z.object({
  workspace: z.string().default('demo'),
  cluster: z.string().optional(),
  platform: z.string().optional(),
  signupAfter: z.string().datetime().optional(),
  signupBefore: z.string().datetime().optional(),
  limit: z.number().min(1).max(1000).default(100),
  offset: z.number().min(0).default(0),
});

export const IngestIdentifyRequestSchema = z.object({
  userId: z.string(),
  properties: z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    platform: z.string().optional(),
    emoji: z.string().optional(),
  }).optional(),
  workspaceId: z.string().default('live'),
});

export const IngestEventRequestSchema = z.object({
  userId: z.string(),
  eventName: z.string(),
  properties: z.record(z.any()).optional(),
  timestamp: z.string().datetime().optional(),
  workspaceId: z.string().default('live'),
});

/** Max events accepted by POST /api/ingest/batch. */
export const BATCH_INGEST_MAX_EVENTS = 1000;

/**
 * One activity event in a batch. `idempotencyKey` and `externalId` are
 * aliases stored as activity.externalId (unique with workspaceId).
 */
export const IngestBatchEventSchema = z.object({
  userId: z.string().min(1),
  event: z.string().min(1).optional(),
  eventName: z.string().min(1).optional(),
  properties: z.record(z.unknown()).optional(),
  timestamp: z.string().optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
  externalId: z.string().min(1).max(256).optional(),
});

export const IngestBatchRequestSchema = z.object({
  workspaceId: z.string().optional(),
  events: z.array(IngestBatchEventSchema).min(1).max(BATCH_INGEST_MAX_EVENTS),
});

export const IngestBatchResponseSchema = z.object({
  success: z.literal(true),
  accepted: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
});

/** Per-source slug used by connect and webhook-in (`/api/ingest/webhook/:source`). */
export const SourceSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);

/** Named connect sources, including csv import mapping. */
export const ConnectSourceIdSchema = z.enum([
  'posthog',
  'mixpanel',
  'amplitude',
  'stripe',
  'revenuecat',
  'mercury',
  'github',
  'csv',
  'ics',
  'resend',
  'smtp',
]);

/**
 * Generic webhook-in body. Destinations may send `distinct_id` / `event`
 * (PostHog-style) or `userId` / `eventName` (canonical / Zapier).
 */
export const IngestWebhookRequestSchema = z
  .object({
    userId: z.string().optional(),
    distinct_id: z.string().optional(),
    eventName: z.string().optional(),
    event: z.union([z.string(), z.record(z.unknown())]).optional(),
    properties: z.record(z.unknown()).optional(),
    timestamp: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough();

export const IngestWebhookResponseSchema = z.object({
  success: z.literal(true),
  accepted: z.number().int().nonnegative(),
});

export const ConnectSourceRequestSchema = z.object({
  source: SourceSlugSchema,
  credentials: z.record(z.string()),
  workspaceId: z.string().default('live'),
});

/** Persist result. Credentials are never echoed. */
export const ConnectSourceResponseSchema = z.object({
  source: SourceSlugSchema,
  workspaceId: z.string(),
  connected: z.literal(true),
  rotated: z.boolean(),
});

/** Disconnect a stored source. Synced rows stay with provenance. */
export const DisconnectSourceRequestSchema = z.object({
  source: SourceSlugSchema,
  workspaceId: z.string().default('live'),
});

export const DisconnectSourceResponseSchema = z.object({
  source: SourceSlugSchema,
  workspaceId: z.string(),
  disconnected: z.literal(true),
});

export const SourceLifecycleActionSchema = z.enum([
  'pause',
  'resume',
  'clear-error',
]);

/** Pause, resume, or acknowledge an error on a stored source. */
export const SourceLifecycleRequestSchema = z.object({
  source: SourceSlugSchema,
  workspaceId: z.string().default('live'),
  action: SourceLifecycleActionSchema,
});

export const SourceLifecycleResponseSchema = z.object({
  source: SourceSlugSchema,
  workspaceId: z.string(),
  action: SourceLifecycleActionSchema,
  paused: z.boolean().optional(),
  cleared: z.boolean().optional(),
});

export const MCP_DISCONNECT_SOURCE_TOOL: McpToolDefinition = {
  name: "disconnect_source",
  description:
    "Disconnect a source: delete stored credentials and sync state. Synced data stays, still tagged with this source. Requires a write-scoped API key. Returns disconnected + view_url.",
  inputSchema: {
    type: "object",
    properties: {
      workspace: {
        type: "string",
        description: "Workspace ID (default: live)",
      },
      source: {
        type: "string",
        description: "Source id (ics, csv, or a connector slug)",
      },
    },
  },
};

/** One field the founder must see verbatim before any PMF+ query leaves the machine. */
export const ResearchOutgoingFieldSchema = z.object({
  field: z.string().min(1),
  value: z.string(),
});

export const ResearchCandidateSchema = z.object({
  personId: z.string(),
  name: z.string(),
  emoji: z.string().nullable(),
  country: z.string().nullable(),
  platform: z.string().nullable(),
  outgoing: z.array(ResearchOutgoingFieldSchema),
});

export const ResearchClaimSchema = z.object({
  title: z.string(),
  source: z.string(),
  url: z.string().optional(),
  confidence: z.enum(['high', 'medium', 'low']),
});

export const ResearchResultSchema = z.object({
  personId: z.string(),
  name: z.string(),
  workspace: z.string(),
  queriedAt: z.string().datetime(),
  query: z.string(),
  outgoing: z.array(ResearchOutgoingFieldSchema),
  claims: z.array(ResearchClaimSchema),
  verified: z.boolean(),
  cached: z.boolean(),
  source: z.string(),
});

export const ResearchRunRequestSchema = z.object({
  workspace: z.string().optional(),
  personId: z.string().min(1),
  approvedFields: z.array(ResearchOutgoingFieldSchema).min(1),
  refresh: z.boolean().optional(),
});

export const ImportKindSchema = z.enum(['users', 'events']);

export const ImportRowErrorSchema = z.object({
  line: z.number().int().positive(),
  message: z.string(),
});

export const ImportRequestSchema = z.object({
  csv: z.string().min(1),
  kind: ImportKindSchema.optional(),
  mapping: z.record(z.string()).optional(),
  preview: z.boolean().optional(),
  workspaceId: z.string().default('live'),
});

export const ImportPreviewResponseSchema = z.object({
  kind: ImportKindSchema,
  columns: z.array(z.string()),
  mapping: z.record(z.string()),
  sample: z.array(z.record(z.string())),
  rowCount: z.number().int().nonnegative(),
});

export const ImportResponseSchema = z.object({
  workspaceId: z.string(),
  kind: ImportKindSchema,
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(ImportRowErrorSchema),
});

export const ExportFormatSchema = z.enum(['json', 'csv']);

export const ExportRestoreSchema = z.object({
  usersAndEvents: z.string(),
  connectorReadModels: z.string(),
});

export const ExportCountsSchema = z.object({
  users: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  readModelRows: z.number().int().nonnegative(),
});

export const ExportUserRowSchema = z.object({
  personId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  platform: z.string().nullable(),
  country: z.string().nullable(),
  timezone: z.string().nullable(),
  emoji: z.string().nullable(),
  signupDate: z.string().datetime().nullable(),
  cluster: z.string().nullable(),
  accountId: z.string().nullable(),
  workspaceId: z.string(),
});

export const ExportEventRowSchema = z.object({
  id: z.number().int(),
  personId: z.string(),
  timestamp: z.string().datetime(),
  eventName: z.string(),
  eventClass: z.enum(['core', 'search', 'share', 'pay']),
  platform: z.string().nullable(),
  externalId: z.string().nullable(),
  workspaceId: z.string(),
});

export const ExportReadModelsSchema = z.object({
  accounts: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  seats: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  mrrSnapshots: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  subscriptionEvents: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  personRevenue: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  balanceSnapshots: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  calendarEvents: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  metricDefs: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  metricPoints: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
});

export const ExportResponseSchema = z.object({
  format: ExportFormatSchema,
  workspaceId: z.string(),
  exportedAt: z.string().datetime(),
  counts: ExportCountsSchema,
  restore: ExportRestoreSchema,
  users: z.array(ExportUserRowSchema).optional(),
  events: z.array(ExportEventRowSchema).optional(),
  readModels: ExportReadModelsSchema.optional(),
  files: z.record(z.string()).optional(),
  view_url: z.string().optional(),
});

export const ApiKeyScopeSchema = z.enum(['read', 'write', 'admin']);

export const SessionCreateRequestSchema = z.object({
  key: z.string().min(1),
  workspace: z.string().optional(),
});

export const SessionStatusResponseSchema = z.object({
  authenticated: z.boolean(),
  workspace: z.string().optional(),
  workspaces: z.array(z.string()).optional(),
  authorized: z.boolean().optional(),
});

export const WorkspaceIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/, "Invalid workspace id");

export const WorkspaceRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});

export const WorkspaceListResponseSchema = z.object({
  workspaces: z.array(WorkspaceRecordSchema),
});

export const WorkspaceCreateRequestSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1).max(80),
});

export const WorkspaceArchiveRequestSchema = z.object({
  id: WorkspaceIdSchema,
});

export const WorkspaceDeleteRequestSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1).max(80),
});

export const WorkspaceDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  workspace: WorkspaceRecordSchema,
});

export const APIKeyCreateRequestSchema = z.object({
  name: z.string(),
  scope: ApiKeyScopeSchema.default('read'),
});

export const APIKeyResponseSchema = z.object({
  id: z.string(),
  key: z.string().optional(), // Only returned on creation
  name: z.string(),
  scope: ApiKeyScopeSchema,
  legacy: z.boolean(),
  lastUsedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});

export const APIKeyDowngradeRequestSchema = z.object({
  id: z.string().optional(),
});

export const APIKeyDowngradeResponseSchema = z.object({
  downgraded: z.array(z.string()),
});

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  actor: z.string(),
  action: z.string(),
  subject: z.string(),
  createdAt: z.string().datetime(),
  workspaceId: z.string(),
});

export const AuditListResponseSchema = z.object({
  workspace: z.string(),
  entries: z.array(AuditEntrySchema),
  total: z.number().int().nonnegative(),
});

export const OutreachStateSchema = z.enum(['waiting', 'approved', 'sent']);

export const OutreachOutcomeSchema = z.enum(['replied', 'interviewed', 'converted']);

export const OutreachDraftSchema = z.object({
  id: z.string(),
  personId: z.string(),
  body: z.string(),
  state: OutreachStateSchema,
  approvedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  sentAt: z.string().datetime().nullable(),
  workspaceId: z.string(),
  outcome: OutreachOutcomeSchema.nullable().optional(),
});

export const OutreachQueueRequestSchema = z.object({
  personId: z.string().min(1),
  body: z.string().min(1),
  workspaceId: z.string().optional(),
});

export const OutreachIdRequestSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().optional(),
});

export const OutreachOutcomeRequestSchema = z.object({
  id: z.string().min(1),
  outcome: OutreachOutcomeSchema.nullable(),
  workspaceId: z.string().optional(),
});

export const OutreachConversionByClusterSchema = z.object({
  cluster: z.string(),
  outreach: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  replied: z.number().int().nonnegative(),
  interviewed: z.number().int().nonnegative(),
  converted: z.number().int().nonnegative(),
  conversionRate: z.number().nonnegative(),
});

export const OutreachDeliverySchema = z.object({
  id: z.number().int(),
  outreachId: z.string(),
  recipient: z.string(),
  approvedBy: z.string(),
  sentAt: z.string().datetime(),
  workspaceId: z.string(),
});

export const OutreachListResponseSchema = z.object({
  drafts: z.array(OutreachDraftSchema),
  conversion: z.array(OutreachConversionByClusterSchema).optional(),
  view_url: z.string().optional(),
});

export const OutreachDraftResponseSchema = z.object({
  draft: OutreachDraftSchema,
  view_url: z.string().optional(),
});

export const OutreachOutcomeResponseSchema = z.object({
  draft: OutreachDraftSchema,
  conversion: z.array(OutreachConversionByClusterSchema),
  view_url: z.string().optional(),
});

export const OutreachSendResponseSchema = z.object({
  draft: OutreachDraftSchema,
  delivery: OutreachDeliverySchema,
  view_url: z.string().optional(),
});

export const AuditQuerySchema = z.object({
  workspace: z.string().default('demo'),
  actor: z.string().optional(),
  action: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const HomeCitySchema = z.object({
  timezone: z.string().min(1),
  label: z.string().min(1).max(80),
});

export const CompanyProfileSchema = z.object({
  workspaceId: z.string(),
  companyName: z.string(),
  foundedAt: z.string().datetime().nullable(),
  homeCity: HomeCitySchema.nullable(),
  dayLabel: z.string(),
  shownCities: z.array(z.string()).nullable(),
  celebratedMilestoneKeys: z.array(z.string()),
});

export const CompanyProfileUpdateSchema = z.object({
  workspaceId: z.string().optional(),
  workspace: z.string().optional(),
  companyName: z.string().optional(),
  foundedAt: z.string().nullable().optional(),
  homeCity: HomeCitySchema.nullable().optional(),
  shownCities: z.array(z.string().min(1).max(200)).max(32).nullable().optional(),
  celebratedMilestoneKeys: z.array(z.string().min(1).max(200)).max(64).optional(),
});

// ========== Error Response ==========

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number(),
});

// ========== Type Exports ==========

export type User = z.infer<typeof UserSchema>;
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;
export type Cohort = z.infer<typeof CohortSchema>;
export type CohortCompareSeries = z.infer<typeof CohortCompareSeriesSchema>;
export type WBRMetric = z.infer<typeof WBRMetricSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type SyncState = z.infer<typeof SyncStateSchema>;
export type SyncHealth = z.infer<typeof SyncHealthSchema>;
export type PresenceCity = z.infer<typeof PresenceCitySchema>;
export type Presence = z.infer<typeof PresenceSchema>;
export type ConnectorHealth = z.infer<typeof ConnectorHealthSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type Account = z.infer<typeof AccountSchema>;
export type MrrSnapshot = z.infer<typeof MrrSnapshotSchema>;
export type SubscriptionEvent = z.infer<typeof SubscriptionEventSchema>;
export type PersonRevenue = z.infer<typeof PersonRevenueSchema>;
export type BalanceSnapshot = z.infer<typeof BalanceSnapshotSchema>;
export type PersonRevenueBlock = z.infer<typeof PersonRevenueBlockSchema>;
export type PersonTimelineEvent = z.infer<typeof PersonTimelineEventSchema>;
export type PersonPanelResponse = z.infer<typeof PersonPanelResponseSchema>;

export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
export type TodayMilestone = z.infer<typeof TodayMilestoneSchema>;
export type UsersListResponse = z.infer<typeof UsersListResponseSchema>;
export type DeleteUserResponse = z.infer<typeof DeleteUserResponseSchema>;
export type CohortsResponse = z.infer<typeof CohortsResponseSchema>;
export type WBRResponse = z.infer<typeof WBRResponseSchema>;
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
export type FreshnessSource = z.infer<typeof FreshnessSourceSchema>;
export type FreshnessResponse = z.infer<typeof FreshnessResponseSchema>;
export type ActivityMatrixUser = z.infer<typeof ActivityMatrixUserSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;
export type SyncStatusResponse = z.infer<typeof SyncStatusResponseSchema>;
export type PinnedMcpTool = (typeof PINNED_MCP_TOOLS)[number];
export type MetricSource = z.infer<typeof MetricSourceSchema>;
export type DefineMetricRequest = z.infer<typeof DefineMetricRequestSchema>;
export type DefineMetricResponse = z.infer<typeof DefineMetricResponseSchema>;
export type MetricPatchRequest = z.infer<typeof MetricPatchRequestSchema>;
export type MetricMutationResponse = z.infer<typeof MetricMutationResponseSchema>;
export type SyncTriggerRequest = z.infer<typeof SyncTriggerRequestSchema>;
export type SyncTriggerResult = z.infer<typeof SyncTriggerResultSchema>;
export type SyncTriggerResponse = z.infer<typeof SyncTriggerResponseSchema>;

export type QueryUsersRequest = z.infer<typeof QueryUsersRequestSchema>;
export type IngestIdentifyRequest = z.infer<typeof IngestIdentifyRequestSchema>;
export type IngestEventRequest = z.infer<typeof IngestEventRequestSchema>;
export type IngestBatchEvent = z.infer<typeof IngestBatchEventSchema>;
export type IngestBatchRequest = z.infer<typeof IngestBatchRequestSchema>;
export type IngestBatchResponse = z.infer<typeof IngestBatchResponseSchema>;
export type IngestWebhookRequest = z.infer<typeof IngestWebhookRequestSchema>;
export type IngestWebhookResponse = z.infer<typeof IngestWebhookResponseSchema>;
export type SourceSlug = z.infer<typeof SourceSlugSchema>;
export type ConnectSourceId = z.infer<typeof ConnectSourceIdSchema>;
export type ConnectSourceRequest = z.infer<typeof ConnectSourceRequestSchema>;
export type ConnectSourceResponse = z.infer<typeof ConnectSourceResponseSchema>;
export type ImportKind = z.infer<typeof ImportKindSchema>;
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;
export type ImportRequest = z.infer<typeof ImportRequestSchema>;
export type ImportPreviewResponse = z.infer<typeof ImportPreviewResponseSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
export type ExportFormat = z.infer<typeof ExportFormatSchema>;
export type ExportRestore = z.infer<typeof ExportRestoreSchema>;
export type ExportCounts = z.infer<typeof ExportCountsSchema>;
export type ExportUserRow = z.infer<typeof ExportUserRowSchema>;
export type ExportEventRow = z.infer<typeof ExportEventRowSchema>;
export type ExportReadModels = z.infer<typeof ExportReadModelsSchema>;
export type ExportResponse = z.infer<typeof ExportResponseSchema>;
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;
export type SessionStatusResponse = z.infer<typeof SessionStatusResponseSchema>;
export type WorkspaceRecord = z.infer<typeof WorkspaceRecordSchema>;
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;
export type WorkspaceCreateRequest = z.infer<typeof WorkspaceCreateRequestSchema>;
export type WorkspaceArchiveRequest = z.infer<typeof WorkspaceArchiveRequestSchema>;
export type WorkspaceDeleteRequest = z.infer<typeof WorkspaceDeleteRequestSchema>;
export type WorkspaceDeleteResponse = z.infer<typeof WorkspaceDeleteResponseSchema>;
export type APIKeyCreateRequest = z.infer<typeof APIKeyCreateRequestSchema>;
export type APIKeyResponse = z.infer<typeof APIKeyResponseSchema>;
export type APIKeyDowngradeRequest = z.infer<typeof APIKeyDowngradeRequestSchema>;
export type APIKeyDowngradeResponse = z.infer<typeof APIKeyDowngradeResponseSchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
export type OutreachState = z.infer<typeof OutreachStateSchema>;
export type OutreachOutcome = z.infer<typeof OutreachOutcomeSchema>;
export type OutreachDraft = z.infer<typeof OutreachDraftSchema>;
export type OutreachQueueRequest = z.infer<typeof OutreachQueueRequestSchema>;
export type OutreachIdRequest = z.infer<typeof OutreachIdRequestSchema>;
export type OutreachOutcomeRequest = z.infer<typeof OutreachOutcomeRequestSchema>;
export type OutreachConversionByCluster = z.infer<typeof OutreachConversionByClusterSchema>;
export type OutreachDelivery = z.infer<typeof OutreachDeliverySchema>;
export type OutreachListResponse = z.infer<typeof OutreachListResponseSchema>;
export type OutreachDraftResponse = z.infer<typeof OutreachDraftResponseSchema>;
export type OutreachOutcomeResponse = z.infer<typeof OutreachOutcomeResponseSchema>;
export type OutreachSendResponse = z.infer<typeof OutreachSendResponseSchema>;
export type ResearchOutgoingField = z.infer<typeof ResearchOutgoingFieldSchema>;
export type ResearchCandidate = z.infer<typeof ResearchCandidateSchema>;
export type ResearchClaim = z.infer<typeof ResearchClaimSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type ResearchRunRequest = z.infer<typeof ResearchRunRequestSchema>;
export type HomeCity = z.infer<typeof HomeCitySchema>;
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;
export type CompanyProfileUpdate = z.infer<typeof CompanyProfileUpdateSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
