import { NextRequest, NextResponse } from "next/server";
import {
  OutreachIdRequestSchema,
  OutreachSendResponseSchema,
} from "@/core/contracts";
import {
  badRequest,
  forbidden,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import { gateOutreach, loadOutreach } from "@/outreach";
import { deliverOutreach } from "@/outreach/deliver";
import {
  MailNotConfiguredError,
  MailSendError,
  OutreachAlreadySentError,
  OutreachNoRecipientError,
  OutreachNotApprovedError,
  OutreachNotFoundError,
  OUTREACH_NOT_APPROVED,
} from "@/outreach/errors";
import {
  outreachViewUrl,
  serializeDelivery,
  serializeDraft,
} from "@/outreach/http";

/**
 * POST /api/v1/outreach/send
 *
 * Calls the single delivery function with the persisted row. An
 * unapproved draft is refused here and inside deliverOutreach.
 */
export async function POST(request: NextRequest) {
  try {
    let raw: unknown = {};
    try {
      raw = await readJsonBounded(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      if (error instanceof SyntaxError) return badRequest("Invalid JSON body");
      throw error;
    }

    const parsed = OutreachIdRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest();

    const gated = await gateOutreach(request, {
      workspace: parsed.data.workspaceId,
      action: "send",
    });
    if (!gated.ok) return gated.response;

    const record = await loadOutreach(gated.workspace, parsed.data.id);
    if (!record) {
      return NextResponse.json({ error: "Outreach draft not found." }, { status: 404 });
    }

    const result = await deliverOutreach(record);

    return NextResponse.json(
      OutreachSendResponseSchema.parse({
        draft: serializeDraft(result.outreach),
        delivery: serializeDelivery(result.delivery),
        view_url: outreachViewUrl(request, gated.workspace),
      })
    );
  } catch (error) {
    if (error instanceof OutreachNotApprovedError) {
      return forbidden(OUTREACH_NOT_APPROVED);
    }
    if (error instanceof OutreachAlreadySentError) {
      return badRequest(error.message);
    }
    if (error instanceof OutreachNoRecipientError) {
      return badRequest(error.message);
    }
    if (error instanceof OutreachNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof MailNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof MailSendError) {
      return internalError();
    }
    logServerError("Send outreach failed");
    return internalError();
  }
}
