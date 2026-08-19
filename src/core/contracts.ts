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
});

export const AccountSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  seats: z.number(),
  activated: z.number(),
  mrr: z.number(),
  workspaceId: z.string(),
});

// ========== API Responses ==========

export const OverviewResponseSchema = z.object({
  workspace: z.string(),
  totalUsers: z.number(),
  activeToday: z.number(),
  weeklyActive: z.number(),
  retentionRate: z.number(),
  smileDetected: z.boolean(),
  exceptionsCount: z.number(),
  upcomingEvents: z.number(),
  view_url: z.string().optional(),
});

export const UsersListResponseSchema = z.object({
  users: z.array(UserSchema),
  total: z.number(),
  workspace: z.string(),
  view_url: z.string().optional(),
});

export const CohortsResponseSchema = z.object({
  cohorts: z.array(CohortSchema),
  smileDetected: z.boolean(),
  workspace: z.string(),
  view_url: z.string().optional(),
});

export const WBRResponseSchema = z.object({
  metrics: z.array(WBRMetricSchema),
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

export const ConnectSourceRequestSchema = z.object({
  source: z.enum(['posthog', 'mixpanel', 'amplitude', 'stripe']),
  credentials: z.record(z.string()),
  workspaceId: z.string().default('live'),
});

export const APIKeyCreateRequestSchema = z.object({
  name: z.string(),
});

export const APIKeyResponseSchema = z.object({
  id: z.string(),
  key: z.string().optional(), // Only returned on creation
  name: z.string(),
  createdAt: z.string().datetime(),
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
export type WBRMetric = z.infer<typeof WBRMetricSchema>;
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;
export type SyncState = z.infer<typeof SyncStateSchema>;
export type Account = z.infer<typeof AccountSchema>;

export type OverviewResponse = z.infer<typeof OverviewResponseSchema>;
export type UsersListResponse = z.infer<typeof UsersListResponseSchema>;
export type CohortsResponse = z.infer<typeof CohortsResponseSchema>;
export type WBRResponse = z.infer<typeof WBRResponseSchema>;
export type CalendarResponse = z.infer<typeof CalendarResponseSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export type QueryUsersRequest = z.infer<typeof QueryUsersRequestSchema>;
export type IngestIdentifyRequest = z.infer<typeof IngestIdentifyRequestSchema>;
export type IngestEventRequest = z.infer<typeof IngestEventRequestSchema>;
export type ConnectSourceRequest = z.infer<typeof ConnectSourceRequestSchema>;
export type APIKeyCreateRequest = z.infer<typeof APIKeyCreateRequestSchema>;
export type APIKeyResponse = z.infer<typeof APIKeyResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
