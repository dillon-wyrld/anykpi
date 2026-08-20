import { NextRequest, NextResponse } from "next/server";
import {
  OutreachListResponseSchema,
  OutreachDraftResponseSchema,
  OutreachQueueRequestSchema,
} from "@/core/contracts";
import { gate } from "@/core/session-auth";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";
import { gateOutreach, listOutreach, queueOutreach } from "@/outreach";
import { outreachViewUrl, queueActor, serializeDraft } from "@/outreach/http";

/**
 * GET /api/v1/outreach — list persisted drafts for a workspace.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("workspace") || "demo";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;

  try {
    const drafts = await listOutreach(gated.workspace);
    return NextResponse.json(
      OutreachListResponseSchema.parse({
        drafts: drafts.map(serializeDraft),
        view_url: outreachViewUrl(request, gated.workspace),
      })
    );
  } catch {
    logServerError("List outreach failed");
    return internalError();
  }
}

/**
 * POST /api/v1/outreach — queue a draft. Write scope (or a session, or
 * public demo). Approval is a different route.
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

    const parsed = OutreachQueueRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest();

    const gated = await gateOutreach(request, {
      workspace: parsed.data.workspaceId,
      action: "queue",
    });
    if (!gated.ok) return gated.response;

    const draft = await queueOutreach({
      workspaceId: gated.workspace,
      personId: parsed.data.personId,
      body: parsed.data.body,
      actor: queueActor(gated.auth),
    });

    return NextResponse.json(
      OutreachDraftResponseSchema.parse({
        draft: serializeDraft(draft),
        view_url: outreachViewUrl(request, gated.workspace),
      }),
      { status: 201 }
    );
  } catch {
    logServerError("Queue outreach failed");
    return internalError();
  }
}
