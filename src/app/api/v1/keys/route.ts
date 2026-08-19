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
  LIVE_WORKSPACE,
} from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";

/**
 * POST /api/v1/keys
 *
 * Mint a key. Never unauthenticated on a public/production interface.
 * First key is allowed only when the table is empty and this is local/dev,
 * or when the caller already has a valid env/admin or hashed key.
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
    });

    const response = APIKeyResponseSchema.parse({
      id: keyId,
      key: rawKey,
      name: params.name,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json(response, { status: 201 });
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
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, { write: false });
  if (!auth.ok) return authResponse(auth);

  try {
    const keys = await db.select().from(schema.apiKeys).all();

    const response = keys.map((k) =>
      APIKeyResponseSchema.parse({
        id: k.id,
        name: k.name,
        createdAt: k.createdAt.toISOString(),
      })
    );

    return NextResponse.json({ keys: response });
  } catch {
    logServerError("List API keys failed");
    return internalError();
  }
}
