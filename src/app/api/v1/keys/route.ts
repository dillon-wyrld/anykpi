import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { nanoid } from "nanoid";
import { APIKeyCreateRequestSchema, APIKeyResponseSchema } from "@/core/contracts";
import { createHash } from "crypto";
import { requireAuth } from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";

/**
 * POST /api/v1/keys
 *
 * Generate a new API key. Never unauthenticated — requires the env admin
 * key or an existing valid key.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAuth(request, { write: true });
  if (denied) return denied;

  try {
    const body = await request.json();
    const params = APIKeyCreateRequestSchema.parse(body);

    const keyId = `ak_${nanoid(24)}`;
    const rawKey = `${keyId}.${nanoid(32)}`;
    const hashedKey = createHash("sha256").update(rawKey).digest("hex");

    await db.insert(schema.apiKeys).values({
      id: keyId,
      hashedKey,
      name: params.name,
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
  const denied = await requireAuth(request, { write: false });
  if (denied) return denied;

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
