import { NextRequest, NextResponse } from "next/server";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { authorize, authResponse, resolveWorkspace } from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";

/**
 * POST /api/ingest/event
 *
 * Track activity event (SDK or agent). Always requires a valid API key.
 * Workspace comes from the key (env admin may choose).
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);

  try {
    const body = await request.json();
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

    return NextResponse.json({ success: true });
  } catch {
    logServerError("Ingest event failed");
    return internalError();
  }
}
