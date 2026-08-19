import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";

/**
 * POST /api/ingest/identify
 *
 * Identify or update user (SDK or agent). Always requires a valid API key.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAuth(request, { write: true });
  if (denied) return denied;

  try {
    const body = await request.json();
    const { userId, properties, workspaceId = "live" } = body;

    if (!userId) {
      return badRequest("userId is required");
    }

    const personId = `person_${userId}`;

    const existing = await db
      .select()
      .from(schema.users)
      .where(
        and(
          eq(schema.users.personId, personId),
          eq(schema.users.workspaceId, workspaceId)
        )
      )
      .get();

    if (existing) {
      const updates: Record<string, string> = {};
      if (properties?.name) updates.name = properties.name;
      if (properties?.email) updates.email = properties.email;
      if (properties?.platform) updates.platform = properties.platform;
      if (properties?.emoji) updates.emoji = properties.emoji;
      if (properties?.country) updates.country = properties.country;

      if (Object.keys(updates).length > 0) {
        await db
          .update(schema.users)
          .set(updates)
          .where(
            and(
              eq(schema.users.personId, personId),
              eq(schema.users.workspaceId, workspaceId)
            )
          );
      }
    } else {
      await db.insert(schema.users).values({
        personId,
        name: properties?.name || `User ${userId}`,
        email: properties?.email || null,
        emoji: properties?.emoji || null,
        platform: properties?.platform || "web",
        country: properties?.country || null,
        signupDate: new Date(),
        cluster: null,
        accountId: null,
        workspaceId,
      });
    }

    return NextResponse.json({ success: true });
  } catch {
    logServerError("Ingest identify failed");
    return internalError();
  }
}
