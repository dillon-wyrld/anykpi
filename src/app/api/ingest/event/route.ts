import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { eq } from "drizzle-orm";
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

/**
 * POST /api/ingest/event
 *
 * Track activity event (SDK or agent). Always requires a valid API key.
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

    const { userId, event, eventName, properties, timestamp } = body;
    const actualEventName = eventName || event;

    if (!userId || !actualEventName) {
      return badRequest("userId and event/eventName are required");
    }

    const personId = `person_${userId}`;
    const eventDate = new Date(timestamp || Date.now());

    let eventClass: "core" | "search" | "share" | "pay" = "core";
    const eventLower = actualEventName.toLowerCase();

    if (eventLower.includes("search") || eventLower.includes("query")) {
      eventClass = "search";
    } else if (eventLower.includes("share") || eventLower.includes("invite")) {
      eventClass = "share";
    } else if (
      eventLower.includes("pay") ||
      eventLower.includes("purchase") ||
      eventLower.includes("subscribe")
    ) {
      eventClass = "pay";
    }

    await db.insert(schema.activity).values({
      personId,
      timestamp: eventDate,
      eventName: actualEventName,
      eventClass,
      platform: properties?.platform || "web",
      workspaceId,
    });

    const existingUser = await db
      .select({ personId: schema.users.personId })
      .from(schema.users)
      .where(eq(schema.users.personId, personId))
      .get();

    if (!existingUser) {
      await db.insert(schema.users).values({
        personId,
        name: properties?.name || `User ${userId}`,
        email: properties?.email || null,
        emoji: properties?.emoji || null,
        platform: properties?.platform || "web",
        country: properties?.country || null,
        signupDate: eventDate,
        cluster: null,
        accountId: null,
        workspaceId,
      });
    }

    await recordWriteAudit(auth, workspaceId, AUDIT_ACTIONS.ingestEvent, personId);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return payloadTooLarge();
    if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
    logServerError("Ingest event failed");
    return internalError();
  }
}
