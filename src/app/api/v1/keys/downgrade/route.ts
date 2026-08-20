import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import {
  APIKeyDowngradeRequestSchema,
  APIKeyDowngradeResponseSchema,
} from "@/core/contracts";
import { authorize, authResponse, LIVE_WORKSPACE } from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";

/**
 * POST /api/v1/keys/downgrade
 *
 * Convert legacy write keys to read (clears the legacy flag). Omit `id`
 * to downgrade every visible legacy key in one call — `anykpi keys downgrade`.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);

  try {
    const body = await request.json().catch(() => ({}));
    const params = APIKeyDowngradeRequestSchema.parse(body);

    const rows = await db.select().from(schema.apiKeys).all();
    const visible = auth.canChooseWorkspace
      ? rows
      : rows.filter((k) => (k.workspaceId || LIVE_WORKSPACE) === auth.keyWorkspace);

    const targets = visible.filter((k) => {
      if (k.legacy !== true) return false;
      if (params.id) return k.id === params.id;
      return true;
    });

    if (params.id && targets.length === 0) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }

    const ids = targets.map((k) => k.id);
    if (ids.length > 0) {
      await db
        .update(schema.apiKeys)
        .set({ scope: "read", legacy: false })
        .where(
          and(
            inArray(schema.apiKeys.id, ids),
            eq(schema.apiKeys.legacy, true)
          )
        );
    }

    return NextResponse.json(
      APIKeyDowngradeResponseSchema.parse({ downgraded: ids })
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return badRequest();
    }
    logServerError("Downgrade API keys failed");
    return internalError();
  }
}
