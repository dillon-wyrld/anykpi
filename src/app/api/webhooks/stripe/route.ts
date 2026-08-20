import { NextRequest, NextResponse } from "next/server";
import { AUDIT_ACTIONS, recordWebhookAudit } from "@/core/audit";
import { loadSourceConfig } from "@/core/sources";
import {
  badRequest,
  internalError,
  logServerError,
  payloadTooLarge,
} from "@/core/errors";
import {
  applyStripeWebhookEvent,
  resolveStripeWebhookSecret,
  STRIPE_SOURCE,
  verifyStripeSignature,
  type StripeEvent,
} from "@/connectors/stripe";

const MAX_BYTES = 256 * 1024;

/**
 * POST /api/webhooks/stripe
 *
 * Signature-verified live updates. Query `workspace` defaults to live.
 * Auth is the signing secret from the sources store — not an API key.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.text();
    if (payload.length > MAX_BYTES) return payloadTooLarge();

    const header = request.headers.get("stripe-signature");
    if (!header) return badRequest("missing signature");

    const workspace = request.nextUrl.searchParams.get("workspace") || "live";
    const stored = await loadSourceConfig(workspace, STRIPE_SOURCE);
    const secret = resolveStripeWebhookSecret(stored ?? undefined);
    if (!secret) {
      return NextResponse.json(
        { error: "webhook secret is not configured" },
        { status: 503 }
      );
    }

    if (!verifyStripeSignature({ payload, header, secret })) {
      return badRequest("invalid signature");
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(payload) as StripeEvent;
    } catch {
      return badRequest("Invalid JSON body");
    }

    const applied = await applyStripeWebhookEvent(workspace, event);
    const subject =
      typeof event.id === "string" && event.id
        ? event.id
        : typeof event.type === "string" && event.type
          ? event.type
          : STRIPE_SOURCE;
    await recordWebhookAudit(workspace, AUDIT_ACTIONS.webhookStripe, subject);
    return NextResponse.json({ ok: true, applied });
  } catch {
    logServerError("Stripe webhook failed");
    return internalError();
  }
}
