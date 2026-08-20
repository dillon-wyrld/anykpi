import { NextRequest, NextResponse } from "next/server";
import {
  OutreachDraftResponseSchema,
  OutreachIdRequestSchema,
} from "@/core/contracts";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import { approveOutreach, gateOutreach, outreachApprover } from "@/outreach";
import { OutreachNotFoundError } from "@/outreach/errors";
import { outreachViewUrl, serializeDraft } from "@/outreach/http";

/**
 * POST /api/v1/outreach/approve
 *
 * Session or admin only. A write-scoped key that queued the draft
 * cannot approve it.
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
      action: "approve",
    });
    if (!gated.ok) return gated.response;

    const draft = await approveOutreach({
      workspaceId: gated.workspace,
      id: parsed.data.id,
      approvedBy: outreachApprover(gated.auth),
    });

    return NextResponse.json(
      OutreachDraftResponseSchema.parse({
        draft: serializeDraft(draft),
        view_url: outreachViewUrl(request, gated.workspace),
      })
    );
  } catch (error) {
    if (error instanceof OutreachNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    logServerError("Approve outreach failed");
    return internalError();
  }
}
