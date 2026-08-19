import { loadConfig, resolveApiKey, resolveApiUrl } from "./config";

/** Server ingest routes (not `/api/v1/ingest/*`). */
export const INGEST_IDENTIFY_PATH = "/api/ingest/identify";
export const INGEST_EVENT_PATH = "/api/ingest/event";

export function authHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  return {
    Authorization: `Bearer ${apiKey}`,
    "x-api-key": apiKey,
  };
}

export async function apiRequest(
  endpoint: string,
  options: RequestInit = {}
): Promise<unknown> {
  const config = loadConfig();
  const apiUrl = resolveApiUrl(config);
  const apiKey = resolveApiKey(config);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(apiKey),
  };

  if (options.headers) {
    const extra = new Headers(options.headers);
    extra.forEach((value, key) => {
      headers[key] = value;
    });
  }

  const response = await fetch(`${apiUrl}${endpoint}`, {
    ...options,
    headers,
  });

  const body = await response.json().catch(() => ({
    error: response.statusText,
  }));

  if (!response.ok) {
    const message =
      (body && typeof body === "object" && "error" in body && body.error) ||
      (body && typeof body === "object" && "message" in body && body.message) ||
      `HTTP ${response.status}`;
    throw new Error(String(message));
  }

  return body;
}
