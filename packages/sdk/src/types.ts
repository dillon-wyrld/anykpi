export interface AnykpiConfig {
  endpoint: string;
  workspaceId?: string;
  apiKey?: string;
  debug?: boolean;
  /** Delay before an automatic flush. 0 flushes immediately (no unref'd timer). */
  flushIntervalMs?: number;
  /** Backoff between flush retries after a network or 5xx failure. */
  retryDelayMs?: number;
  /** Flush attempts for a buffered batch (including the first try). */
  maxRetries?: number;
}

export type JsonPrimitive = string | number | boolean | null;

export interface EventProperties {
  [key: string]: JsonPrimitive;
}

export interface UserProperties {
  name?: string;
  email?: string;
  platform?: string;
  country?: string;
  [key: string]: JsonPrimitive | undefined;
}

export interface User {
  userId: string;
  properties?: UserProperties;
}
