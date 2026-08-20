import { NextRequest, NextResponse } from "next/server";
import {
  OutreachOutcomeRequestSchema,
  OutreachOutcomeResponseSchema,
} from "@/core/contracts";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import {
  loadOutreachConversion,
  setOutreachOutcome,
} from "@/core/outreach-outcomes";
import { gateOutreach, loadOutreach } from "@/outreach";
import { OutreachNotFoundError } from "@/outreach/errors";
import { outreachViewUrl, queueActor, serializeDraft } from "@/outreach/http";

/**
 * POST /api/v1/outreach/outcome
 *
 * Tag a persisted draft replied / interviewed / converted. Stored in
 * `config` keyed by outreach id so schema.ts stays untouched.
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

    const parsed = OutreachOutcomeRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest();

    const gated = await gateOutreach(request, {
      workspace: parsed.data.workspaceId,
      action: "outcome",
    });
    if (!gated.ok) return gated.response;

    const outcome = await setOutreachOutcome({
      workspaceId: gated.workspace,
      id: parsed.data.id,
      outcome: parsed.data.outcome,
      actor: queueActor(gated.auth),
    });

    const draft = await loadOutreach(gated.workspace, parsed.data.id);
    if (!draft) throw new OutreachNotFoundError();

    return NextResponse.json(
      OutreachOutcomeResponseSchema.parse({
        draft: serializeDraft(draft, outcome),
        conversion: await loadOutreachConversion(gated.workspace),
        view_url: outreachViewUrl(request, gated.workspace),
      })
    );
  } catch (error) {
    if (error instanceof OutreachNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    logServerError("Tag outreach outcome failed");
    return internalError();
  }
}
