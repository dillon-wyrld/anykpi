import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { nanoid } from "nanoid";
import { APIKeyCreateRequestSchema, APIKeyResponseSchema } from "@/core/contracts";
import { createHash } from "crypto";
import {
  authorize,
  authResponse,
  canBootstrapFirstKey,
  DEFAULT_NEW_KEY_SCOPE,
  LIVE_WORKSPACE,
  MINT_ADMIN_KEY_ERROR,
} from "@/core/auth";
import { badRequest, forbidden, internalError, logServerError } from "@/core/errors";

function keyMetadata(row: {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  scope: string | null;
  legacy: boolean | null;
}, rawKey?: string) {
  return APIKeyResponseSchema.parse({
    id: row.id,
    ...(rawKey ? { key: rawKey } : {}),
    name: row.name,
    scope: row.scope === "read" || row.scope === "write" || row.scope === "admin"
      ? row.scope
      : "write",
    legacy: row.legacy === true,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  });
}

/**
 * POST /api/v1/keys
 *
 * Mint a key. Never unauthenticated on a public/production interface.
 * First key is allowed only when the table is empty and this is local/dev,
 * or when the caller already has a valid env/admin or hashed key.
 * New keys default to read.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) {
    const bootstrap = await canBootstrapFirstKey();
    if (!bootstrap) {
      return authResponse(auth);
    }
  }

  try {
    const body = await request.json().catch(() => ({}));
    const params = APIKeyCreateRequestSchema.parse(body);
    const scope = params.scope ?? DEFAULT_NEW_KEY_SCOPE;

    if (scope === "admin" && (!auth.ok || auth.scope !== "admin")) {
      return forbidden(MINT_ADMIN_KEY_ERROR);
    }

    let workspaceId = LIVE_WORKSPACE;
    if (auth.ok && auth.canChooseWorkspace) {
      workspaceId = typeof body.workspace === "string" && body.workspace
        ? body.workspace
        : LIVE_WORKSPACE;
    } else if (auth.ok && auth.keyWorkspace) {
      workspaceId = auth.keyWorkspace;
    }

    const keyId = `ak_${nanoid(24)}`;
    const rawKey = `${keyId}.${nanoid(32)}`;
    const hashedKey = createHash("sha256").update(rawKey).digest("hex");

    await db.insert(schema.apiKeys).values({
      id: keyId,
      hashedKey,
      name: params.name,
      workspaceId,
      createdAt: new Date(),
      scope,
      legacy: false,
    });

    return NextResponse.json(
      keyMetadata(
        {
          id: keyId,
          name: params.name,
          createdAt: new Date(),
          lastUsedAt: null,
          scope,
          legacy: false,
        },
        rawKey
      ),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return badRequest();
    }

    logServerError("Create API key failed");
    return internalError();
  }
}

/**
 * GET /api/v1/keys
 *
 * List API key metadata (never the raw key). Requires a valid key.
 * Includes scope, last-used, and a `legacy` flag for pre-scope keys.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, { write: false });
  if (!auth.ok) return authResponse(auth);

  try {
    const keys = await db.select().from(schema.apiKeys).all();

    // A workspace-bound key may only see its own workspace's keys; the env
    // admin (canChooseWorkspace) sees all. Prevents cross-workspace metadata
    // enumeration.
    const visible = auth.canChooseWorkspace
      ? keys
      : keys.filter((k) => (k.workspaceId || LIVE_WORKSPACE) === auth.keyWorkspace);

    const response = visible.map((k) => keyMetadata(k));

    return NextResponse.json({ keys: response });
  } catch {
    logServerError("List API keys failed");
    return internalError();
  }
}
