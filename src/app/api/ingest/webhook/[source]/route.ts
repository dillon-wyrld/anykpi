import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/core/db";
import * as schema from "@/core/schema";
import { AUDIT_ACTIONS, recordWebhookAudit } from "@/core/audit";
import { LIVE_WORKSPACE } from "@/core/auth";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readTextBounded,
  tooManyRequests,
  unauthorized,
} from "@/core/errors";
import { clientKeyFrom, rateLimit } from "@/core/rate-limit";
import { loadSourceConfig } from "@/core/sources";
import {
  classifyEventName,
  isSourceSlug,
  normalizeWebhookPayload,
  sourceWebhookSecret,
  verifyWebhookSignature,
} from "@/core/webhook";

/**
 * POST /api/ingest/webhook/:source
 *
 * Realtime push path. Authenticated by a per-source HMAC secret stored
 * via POST /api/v1/connect (encrypted at rest). Re-submitting rotates
 * the secret and invalidates the previous one immediately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const limit = rateLimit(clientKeyFrom(request.headers));
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  try {
    const { source } = await params;
    if (!isSourceSlug(source)) {
      return unauthorized();
    }

    const workspace =
      request.nextUrl.searchParams.get("workspace")?.trim() || LIVE_WORKSPACE;

    let raw: string;
    try {
      raw = await readTextBounded(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      throw error;
    }

    const config = await loadSourceConfig(workspace, source);
    const secret = sourceWebhookSecret(config);
    if (!secret || !verifyWebhookSignature(secret, raw, request.headers)) {
      return unauthorized();
    }

    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      return badRequest("Invalid JSON body");
    }

    const events = normalizeWebhookPayload(parsed);
    if (events.length === 0) {
      return badRequest("userId and event/eventName are required");
    }

    for (const event of events) {
      await writeActivity(workspace, event);
    }

    await recordWebhookAudit(workspace, AUDIT_ACTIONS.ingestWebhook, source);
    return NextResponse.json({ success: true, accepted: events.length });
  } catch {
    logServerError("Ingest webhook failed");
    return internalError();
  }
}

async function writeActivity(
  workspaceId: string,
  event: {
    userId: string;
    eventName: string;
    properties?: Record<string, unknown>;
    timestamp?: string;
  }
): Promise<void> {
  const personId = `person_${event.userId}`;
  const eventDate = new Date(event.timestamp || Date.now());
  const properties = event.properties ?? {};
  const platform =
    typeof properties.platform === "string" ? properties.platform : "web";
  const name =
    typeof properties.name === "string"
      ? properties.name
      : `User ${event.userId}`;
  const email = typeof properties.email === "string" ? properties.email : null;
  const emoji = typeof properties.emoji === "string" ? properties.emoji : null;
  const country =
    typeof properties.country === "string" ? properties.country : null;

  await db.insert(schema.activity).values({
    personId,
    timestamp: eventDate,
    eventName: event.eventName,
    eventClass: classifyEventName(event.eventName),
    platform,
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
      name,
      email,
      emoji,
      platform,
      country,
      signupDate: eventDate,
      cluster: null,
      accountId: null,
      workspaceId,
    });
  }
}
