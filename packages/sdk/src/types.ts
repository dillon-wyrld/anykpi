export interface AnykpiConfig {
  endpoint: string;
  workspaceId?: string;
  apiKey?: string;
  debug?: boolean;
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
