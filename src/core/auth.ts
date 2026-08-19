import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export const DEMO_WORKSPACE = "demo";

export const MCP_READ_ONLY_TOOLS = new Set([
  "get_overview",
  "query_users",
  "get_cohorts",
  "get_wbr",
  "get_calendar",
  "install_sdk",
]);

export type AuthorizeOptions = {
  /** Workspace being accessed. Only explicit `demo` is public-read. */
  workspace?: string | null;
  /** Writes (ingest, identify, keys, sync, MCP mutations) always require a key. */
  write?: boolean;
  /** MCP tools/list stays open. */
  allowAnonymous?: boolean;
};

export type AuthOk = { ok: true };
export type AuthDenied = { ok: false; status: 401 | 503; error: string };
export type AuthResult = AuthOk | AuthDenied;

function header(request: { headers: { get(name: string): string | null } }, name: string): string | null {
  return request.headers.get(name);
}

/** Read `Authorization: Bearer <key>` or `x-api-key`. */
export function extractApiKey(request: {
  headers: { get(name: string): string | null };
}): string | null {
  const auth = header(request, "authorization") ?? header(request, "Authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match?.[1]) {
      const key = match[1].trim();
      return key.length > 0 ? key : null;
    }
  }

  const headerKey = header(request, "x-api-key") ?? header(request, "X-API-Key");
  if (headerKey) {
    const key = headerKey.trim();
    return key.length > 0 ? key : null;
  }

  return null;
}

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function envApiKey(): string | undefined {
  const key = process.env.ANYKPI_API_KEY;
  if (!key || key.trim().length === 0) return undefined;
  return key;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function matchesStoredKey(key: string): Promise<boolean> {
  try {
    const { db } = await import("./db");
    const schema = await import("./schema");
    const { eq } = await import("drizzle-orm");
    const hashedKey = hashApiKey(key);
    const found = await db
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.hashedKey, hashedKey))
      .get();
    return Boolean(found);
  } catch {
    return false;
  }
}

async function isValidApiKey(provided: string): Promise<boolean> {
  const configured = envApiKey();
  if (configured && timingSafeEqualString(provided, configured)) {
    return true;
  }
  return matchesStoredKey(provided);
}

/**
 * Default-secure gate:
 * - demo workspace + GET/read: allowed without a key (seeded fictional people)
 * - any other workspace, and all writes: valid key required
 * - production with unset ANYKPI_API_KEY: 503 (do not run open)
 */
export async function authorize(
  request: { headers: { get(name: string): string | null } },
  options: AuthorizeOptions = {}
): Promise<AuthResult> {
  if (options.allowAnonymous) {
    return { ok: true };
  }

  const isWrite = options.write === true;
  const isDemoRead = !isWrite && options.workspace === DEMO_WORKSPACE;

  if (isDemoRead) {
    return { ok: true };
  }

  const configured = envApiKey();
  if (isProduction() && !configured) {
    return {
      ok: false,
      status: 503,
      error: "set ANYKPI_API_KEY",
    };
  }

  const provided = extractApiKey(request);
  if (!provided) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  if (await isValidApiKey(provided)) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: "Unauthorized" };
}

export function authResponse(result: AuthDenied): NextResponse {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/** Returns a 401/503 response when denied, otherwise null. */
export async function requireAuth(
  request: { headers: { get(name: string): string | null } },
  options: AuthorizeOptions = {}
): Promise<NextResponse | null> {
  const result = await authorize(request, options);
  if (result.ok) return null;
  return authResponse(result);
}

/** Forward a presented key on same-origin view fetches (v1 → /api/views). */
export function authForwardHeaders(request: {
  headers: { get(name: string): string | null };
}): Record<string, string> {
  const key = extractApiKey(request);
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

export function isReadOnlyMcpTool(name: string | undefined): boolean {
  return Boolean(name && MCP_READ_ONLY_TOOLS.has(name));
}
