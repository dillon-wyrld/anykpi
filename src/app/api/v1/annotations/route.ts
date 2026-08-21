import { NextRequest, NextResponse } from "next/server";
import {
  AnnotateRequestSchema,
  AnnotateResponseSchema,
  AnnotationsListResponseSchema,
  AnnotationTargetTypeInputSchema,
} from "@/core/contracts";
import { AUDIT_ACTIONS, recordWriteAudit } from "@/core/audit";
import { gate, gateDisplayPrefs } from "@/core/session-auth";
import { publicBaseUrl } from "@/core/view-state";
import {
  AnnotateError,
  annotationsListViewUrl,
  annotationViewUrl,
  createAnnotation,
  listAnnotations,
  persistTargetType,
  serializeAnnotation,
} from "@/core/annotations";
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from "@/core/errors";

function requestedWorkspace(
  request: NextRequest,
  body?: { workspaceId?: string; workspace?: string },
  fallback = "live"
) {
  const { searchParams } = new URL(request.url);
  return (
    body?.workspaceId ||
    body?.workspace ||
    searchParams.get("workspace") ||
    searchParams.get("workspaceId") ||
    fallback
  );
}

/**
 * GET /api/v1/annotations
 *
 * List pinned stickers and notes. Demo is public-read; live needs a key
 * or a signed browser session.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gated = await gate(request, {
      workspace: requestedWorkspace(request, undefined, "demo"),
      write: false,
    });
    if (!gated.ok) return gated.response;

    const rawTarget = searchParams.get("targetType");
    const parsedTarget = rawTarget
      ? AnnotationTargetTypeInputSchema.safeParse(rawTarget)
      : null;
    if (rawTarget && !parsedTarget?.success) return badRequest();
    const targetType = parsedTarget?.success
      ? persistTargetType(parsedTarget.data)
      : undefined;
    const targetId = searchParams.get("targetId") ?? undefined;

    const rows = await listAnnotations(gated.workspace, {
      targetType,
      targetId: targetId || undefined,
    });
    const viewUrl = annotationsListViewUrl(
      publicBaseUrl(request),
      gated.workspace
    );

    return NextResponse.json(
      AnnotationsListResponseSchema.parse({
        annotations: rows.map(serializeAnnotation),
        workspace: gated.workspace,
        view_url: viewUrl,
        viewUrl,
      })
    );
  } catch (error) {
    if (error instanceof AnnotateError) return badRequest(error.message);
    logServerError("List annotations failed");
    return internalError();
  }
}

/**
 * POST /api/v1/annotations
 *
 * annotate — write-scoped. Same validation as MCP. A signed browser
 * session may pin from the dashboard.
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

    const parsed = AnnotateRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) return badRequest();

    const gated = await gateDisplayPrefs(request, {
      workspace: requestedWorkspace(request, parsed.data),
      write: true,
    });
    if (!gated.ok) return gated.response;

    const row = await createAnnotation(gated.workspace, parsed.data);
    await recordWriteAudit(
      gated.auth,
      gated.workspace,
      AUDIT_ACTIONS.annotationCreate,
      `${row.type}:${row.targetType}:${row.targetId}`
    );

    const viewUrl = annotationViewUrl(
      publicBaseUrl(request),
      gated.workspace,
      row.targetType,
      row.targetId
    );
    return NextResponse.json(
      AnnotateResponseSchema.parse({
        annotation: serializeAnnotation(row),
        workspace: gated.workspace,
        view_url: viewUrl,
        viewUrl,
      }),
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AnnotateError) return badRequest(error.message);
    logServerError("Annotate failed");
    return internalError();
  }
}
