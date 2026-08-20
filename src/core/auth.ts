import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

export const DEMO_WORKSPACE = "demo";
export const LIVE_WORKSPACE = "live";

export const MCP_READ_ONLY_TOOLS = new Set([
  "get_overview",
  "query_users",
  "get_cohorts",
  "get_wbr",
  "get_calendar",
  "install_sdk",
]);

export type RequestLike = { headers: { get(name: string): string | null } };

export const API_KEY_SCOPES = ["read", "write", "admin"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** New keys default to read. Existing rows migrate to write + legacy. */
export const DEFAULT_NEW_KEY_SCOPE: ApiKeyScope = "read";
export const MIGRATED_KEY_SCOPE: ApiKeyScope = "write";

export const READ_KEY_WRITE_ERROR =
  "This API key can only read. Use a write or admin key to change data.";

export const MINT_ADMIN_KEY_ERROR = "Only an admin key can mint an admin key.";

export type AuthorizeOptions = {
  /** Workspace the client asked for. Unauthenticated GET is demo-only. */
  workspace?: string | null;
  /** Writes (ingest, identify, keys, MCP mutations) always require a key. */
  write?: boolean;
  /** MCP tools/list stays open. */
  allowAnonymous?: boolean;
};

/** `session` is reserved for the browser-session ticket; hashed keys store their id. */
export type AuthActor = "anonymous" | "env" | "hashed" | "session";

/** Actor strings persisted on the audit log (key id, `env`, or `session`). */
export const AUDIT_ACTOR_ENV = "env";
export const AUDIT_ACTOR_SESSION = "session";
/** HMAC / signature inbound writes are not a key, env, or session. */
export const AUDIT_ACTOR_WEBHOOK = "webhook";

export type AuthOk = {
  ok: true;
  actor: AuthActor;
  /** Bound workspace for hashed keys. */
  keyWorkspace?: string;
  canChooseWorkspace: boolean;
  scope: ApiKeyScope;
  keyId?: string;
  legacy?: boolean;
};

export type AuthDenied = { ok: false; status: 401 | 403 | 503; error: string };
export type AuthResult = AuthOk | AuthDenied;

/** Map a verified principal onto the audit actor column. */
export function actorFromAuth(auth: AuthOk): string {
  if (auth.actor === "session") return AUDIT_ACTOR_SESSION;
  if (auth.actor === "env") return AUDIT_ACTOR_ENV;
  if (auth.keyId) return auth.keyId;
  return AUDIT_ACTOR_ENV;
}

function header(request: RequestLike, name: string): string | null {
  return request.headers.get(name);
}

/** Read `Authorization: Bearer <key>` or `x-api-key`. */
export function extractApiKey(request: RequestLike): string | null {
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

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Timing-safe compare of a presented key against a stored SHA-256 hex digest. */
export function hashedKeyMatches(provided: string, storedHex: string): boolean {
  const digest = sha256Hex(provided);
  return timingSafeEqualString(digest, storedHex);
}

export function matchesEnvAdminKey(provided: string): boolean {
  const configured = envApiKey();
  if (!configured) return false;
  return timingSafeEqualString(provided, configured);
}

export function parseApiKeyScope(value: string | null | undefined): ApiKeyScope {
  if (value === "read" || value === "write" || value === "admin") return value;
  return MIGRATED_KEY_SCOPE;
}

export function scopeAllowsWrite(scope: ApiKeyScope): boolean {
  return scope === "write" || scope === "admin";
}

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

type StoredKey = {
  id: string;
  hashedKey: string;
  workspaceId: string;
  scope: ApiKeyScope;
  legacy: boolean;
};

async function loadStoredKeys(): Promise<StoredKey[]> {
  try {
    const { db } = await import("./db");
    const schema = await import("./schema");
    const rows = await db
      .select({
        id: schema.apiKeys.id,
        hashedKey: schema.apiKeys.hashedKey,
        workspaceId: schema.apiKeys.workspaceId,
        scope: schema.apiKeys.scope,
        legacy: schema.apiKeys.legacy,
      })
      .from(schema.apiKeys)
      .all();
    return rows.map((row) => ({
      id: row.id,
      hashedKey: row.hashedKey,
      workspaceId: row.workspaceId || LIVE_WORKSPACE,
      scope: parseApiKeyScope(row.scope),
      legacy: row.legacy === true,
    }));
  } catch {
    return [];
  }
}

async function touchLastUsed(id: string): Promise<void> {
  try {
    const { db } = await import("./db");
    const schema = await import("./schema");
    const { eq } = await import("drizzle-orm");
    await db
      .update(schema.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, id));
  } catch {
    // last-used is best-effort and must not fail the request
  }
}

async function matchStoredKey(provided: string): Promise<StoredKey | null> {
  const rows = await loadStoredKeys();
  for (const row of rows) {
    if (hashedKeyMatches(provided, row.hashedKey)) {
      return row;
    }
  }
  return null;
}

export async function countApiKeys(): Promise<number> {
  try {
    const { db } = await import("./db");
    const schema = await import("./schema");
    const rows = await db.select({ id: schema.apiKeys.id }).from(schema.apiKeys).all();
    return rows.length;
  } catch {
    return -1;
  }
}

/**
 * First key may be minted without a bearer only when the table is empty
 * and this process is local/dev. Production always requires an admin/env key.
 */
export async function canBootstrapFirstKey(): Promise<boolean> {
  if (isProduction()) return false;
  const count = await countApiKeys();
  return count === 0;
}

async function verifyPresentedKey(provided: string): Promise<AuthOk | null> {
  if (matchesEnvAdminKey(provided)) {
    return {
      ok: true,
      actor: "env",
      canChooseWorkspace: true,
      scope: "admin",
    };
  }

  const stored = await matchStoredKey(provided);
  if (stored) {
    await touchLastUsed(stored.id);
    const admin = stored.scope === "admin";
    return {
      ok: true,
      actor: "hashed",
      keyWorkspace: stored.workspaceId || LIVE_WORKSPACE,
      canChooseWorkspace: admin,
      scope: stored.scope,
      keyId: stored.id,
      legacy: stored.legacy,
    };
  }

  return null;
}

/**
 * Default-secure gate:
 * - demo workspace + GET/read: allowed without a key
 * - writes and non-demo reads: env admin key or SHA-256 hashed key
 * - production with no env key and no valid hashed key: 503
 */
export async function authorize(
  request: RequestLike,
  options: AuthorizeOptions = {}
): Promise<AuthResult> {
  if (options.allowAnonymous) {
    return { ok: true, actor: "anonymous", canChooseWorkspace: false, scope: "read" };
  }

  const isWrite = options.write === true;
  const isDemoRead = !isWrite && options.workspace === DEMO_WORKSPACE;

  if (isDemoRead) {
    return { ok: true, actor: "anonymous", canChooseWorkspace: false, scope: "read" };
  }

  const provided = extractApiKey(request);
  const configured = envApiKey();

  if (!provided) {
    if (isProduction() && !configured) {
      return { ok: false, status: 503, error: "set ANYKPI_API_KEY" };
    }
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const verified = await verifyPresentedKey(provided);
  if (verified) {
    if (isWrite && !scopeAllowsWrite(verified.scope)) {
      return { ok: false, status: 403, error: READ_KEY_WRITE_ERROR };
    }
    return verified;
  }

  if (isProduction() && !configured) {
    return { ok: false, status: 503, error: "set ANYKPI_API_KEY" };
  }

  return { ok: false, status: 401, error: "Unauthorized" };
}

/**
 * Writes: hashed key workspace wins; env admin may choose.
 * Reads: demo stays readable; otherwise hashed keys cannot pick another live workspace.
 */
export function resolveWorkspace(
  auth: AuthOk,
  requested: string | null | undefined,
  write: boolean
): { workspace: string } | AuthDenied {
  const asked = requested && requested.length > 0 ? requested : undefined;

  if (auth.actor === "anonymous") {
    if (write) {
      return { ok: false, status: 401, error: "Unauthorized" };
    }
    return { workspace: DEMO_WORKSPACE };
  }

  if (auth.canChooseWorkspace) {
    if (write) {
      return { workspace: asked || LIVE_WORKSPACE };
    }
    return { workspace: asked || DEMO_WORKSPACE };
  }

  const bound = auth.keyWorkspace || LIVE_WORKSPACE;
  if (write) {
    if (asked && asked !== bound) {
      return { workspace: bound };
    }
    return { workspace: bound };
  }

  if (!asked || asked === DEMO_WORKSPACE || asked === bound) {
    return { workspace: asked || bound };
  }

  return { ok: false, status: 401, error: "Unauthorized" };
}

export function authResponse(result: AuthDenied): NextResponse {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

export async function requireAuth(
  request: RequestLike,
  options: AuthorizeOptions = {}
): Promise<NextResponse | null> {
  const result = await authorize(request, options);
  if (result.ok) return null;
  return authResponse(result);
}

export async function gate(
  request: RequestLike,
  options: AuthorizeOptions = {}
): Promise<
  | { ok: true; auth: AuthOk; workspace: string }
  | { ok: false; response: NextResponse }
> {
  const result = await authorize(request, options);
  if (!result.ok) {
    return { ok: false, response: authResponse(result) };
  }

  const resolved = resolveWorkspace(
    result,
    options.workspace,
    options.write === true
  );
  if ("ok" in resolved && resolved.ok === false) {
    return { ok: false, response: authResponse(resolved) };
  }

  return {
    ok: true,
    auth: result,
    workspace: (resolved as { workspace: string }).workspace,
  };
}

export { publicBaseUrl } from "./view-state";

export function isReadOnlyMcpTool(name: string | undefined): boolean {
  return Boolean(name && MCP_READ_ONLY_TOOLS.has(name));
}
