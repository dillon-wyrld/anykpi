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

export type AuthorizeOptions = {
  /** Workspace the client asked for. Unauthenticated GET is demo-only. */
  workspace?: string | null;
  /** Writes (ingest, identify, keys, MCP mutations) always require a key. */
  write?: boolean;
  /** MCP tools/list stays open. */
  allowAnonymous?: boolean;
};

export type AuthActor = "anonymous" | "env" | "hashed";

export type AuthOk = {
  ok: true;
  actor: AuthActor;
  /** Bound workspace for hashed keys. */
  keyWorkspace?: string;
  canChooseWorkspace: boolean;
};

export type AuthDenied = { ok: false; status: 401 | 503; error: string };
export type AuthResult = AuthOk | AuthDenied;

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

type StoredKey = { hashedKey: string; workspaceId: string };

async function loadStoredKeys(): Promise<StoredKey[]> {
  try {
    const { db } = await import("./db");
    const schema = await import("./schema");
    const rows = await db
      .select({
        hashedKey: schema.apiKeys.hashedKey,
        workspaceId: schema.apiKeys.workspaceId,
      })
      .from(schema.apiKeys)
      .all();
    return rows.map((row) => ({
      hashedKey: row.hashedKey,
      workspaceId: row.workspaceId || LIVE_WORKSPACE,
    }));
  } catch {
    return [];
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
    };
  }

  const stored = await matchStoredKey(provided);
  if (stored) {
    return {
      ok: true,
      actor: "hashed",
      keyWorkspace: stored.workspaceId || LIVE_WORKSPACE,
      canChooseWorkspace: false,
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
    return { ok: true, actor: "anonymous", canChooseWorkspace: false };
  }

  const isWrite = options.write === true;
  const isDemoRead = !isWrite && options.workspace === DEMO_WORKSPACE;

  if (isDemoRead) {
    return { ok: true, actor: "anonymous", canChooseWorkspace: false };
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

export function publicBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:3000"
  );
}

export function isReadOnlyMcpTool(name: string | undefined): boolean {
  return Boolean(name && MCP_READ_ONLY_TOOLS.has(name));
}
