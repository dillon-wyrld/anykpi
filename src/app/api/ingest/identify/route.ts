import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq, and } from "drizzle-orm";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import { authorize, authResponse, resolveWorkspace } from "@/core/auth";
import {
  badRequest,
  internalError,
  logServerError,
  payloadTooLarge,
  PayloadTooLargeError,
  readJsonBounded,
  tooManyRequests,
} from "@/core/errors";
import { rateLimit, clientKeyFrom } from "@/core/rate-limit";
import { isTombstoned } from "@/core/tombstones";
import { ensureWorkspace } from "@/core/workspaces";

/**
 * POST /api/ingest/identify
 *
 * Identify or update user (SDK or agent). Always requires a valid API key.
 * Workspace comes from the key (env admin may choose). Rate-limited and
 * size-bounded to prevent flooding / memory exhaustion.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);

  const limit = rateLimit(clientKeyFrom(request.headers));
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  try {
    const body = (await readJsonBounded(request)) as Record<string, any>;
    const resolved = resolveWorkspace(auth, body.workspaceId, true);
    if ("ok" in resolved && resolved.ok === false) {
      return authResponse(resolved);
    }
    const workspaceId = (resolved as { workspace: string }).workspace;

    await ensureWorkspace(workspaceId);

    const { userId, properties } = body;

    if (!userId) {
      return badRequest("userId is required");
    }

    const personId = `person_${userId}`;
    if (
      await isTombstoned(workspaceId, {
        personId,
        email: typeof properties?.email === "string" ? properties.email : null,
      })
    ) {
      return NextResponse.json({ success: true });
    }

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

    await recordWriteAudit(auth, workspaceId, AUDIT_ACTIONS.ingestIdentify, personId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return payloadTooLarge();
    if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
    logServerError("Ingest identify failed");
    return internalError();
  }
}
