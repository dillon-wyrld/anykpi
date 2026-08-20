import { NextRequest, NextResponse } from "next/server";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import { authorize, authResponse, resolveWorkspace } from "@/core/auth";
import {
  IngestBatchRequestSchema,
  type IngestBatchEvent,
} from "@/core/contracts";
import {
  badRequest,
  internalError,
  logServerError,
  payloadTooLarge,
  PayloadTooLargeError,
  readJsonBounded,
  tooManyRequests,
} from "@/core/errors";
import {
  BATCH_INGEST_MAX_BYTES,
  runIngestBatch,
  type IngestBatchEventInput,
} from "@/core/ingest-batch";
import { clientKeyFrom, rateLimit } from "@/core/rate-limit";

function normalizeEvent(event: IngestBatchEvent): IngestBatchEventInput | null {
  const eventName = event.eventName || event.event;
  if (!event.userId || !eventName) return null;
  return {
    userId: event.userId,
    eventName,
    properties: event.properties,
    timestamp: event.timestamp,
    idempotencyKey: event.idempotencyKey,
    externalId: event.externalId,
  };
}

/**
 * POST /api/ingest/batch
 *
 * Track up to 1k activity events in one transaction. Writes always require
 * a valid API key. Idempotent on activity (workspaceId, externalId) —
 * replaying the same keys is a no-op.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, { write: true });
  if (!auth.ok) return authResponse(auth);

  const limit = rateLimit(clientKeyFrom(request.headers));
  if (!limit.allowed) return tooManyRequests(limit.retryAfterSeconds);

  try {
    const body = await readJsonBounded(request, BATCH_INGEST_MAX_BYTES);
    const parsed = IngestBatchRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return badRequest("events (1–1000) are required");
    }

    const resolved = resolveWorkspace(auth, parsed.data.workspaceId, true);
    if ("ok" in resolved && resolved.ok === false) {
      return authResponse(resolved);
    }
    const workspaceId = (resolved as { workspace: string }).workspace;

    const events: IngestBatchEventInput[] = [];
    for (const event of parsed.data.events) {
      const normalized = normalizeEvent(event);
      if (!normalized) {
        return badRequest("userId and event/eventName are required");
      }
      events.push(normalized);
    }

    const result = runIngestBatch(workspaceId, events);
    await recordWriteAudit(
      auth,
      workspaceId,
      AUDIT_ACTIONS.ingestBatch,
      String(result.accepted)
    );
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return payloadTooLarge();
    if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
    if (error instanceof RangeError) return badRequest(error.message);
    logServerError("Ingest batch failed");
    return internalError();
  }
}
