import { NextRequest, NextResponse } from "next/server";
import { AuditListResponseSchema, AuditQuerySchema } from "@/core/contracts";
import { listAudit } from "@/core/audit";
import { gate } from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";

/**
 * GET /api/v1/audit
 *
 * Query the action audit log. Demo stays public-read. Filter by actor
 * and since/until to answer "what did my agent do yesterday?" in one call.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = AuditQuerySchema.safeParse({
      workspace: searchParams.get("workspace") ?? undefined,
      actor: searchParams.get("actor") ?? undefined,
      action: searchParams.get("action") ?? undefined,
      since: searchParams.get("since") ?? undefined,
      until: searchParams.get("until") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    });
    if (!parsed.success) {
      return badRequest();
    }

    const gated = await gate(request, {
      workspace: parsed.data.workspace,
      write: false,
    });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const listed = await listAudit({
      workspaceId: workspace,
      actor: parsed.data.actor,
      action: parsed.data.action,
      since: parsed.data.since ? new Date(parsed.data.since) : undefined,
      until: parsed.data.until ? new Date(parsed.data.until) : undefined,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });

    const response = AuditListResponseSchema.parse({
      workspace,
      total: listed.total,
      entries: listed.entries.map((entry) => ({
        id: entry.id,
        actor: entry.actor,
        action: entry.action,
        subject: entry.subject,
        createdAt: entry.createdAt.toISOString(),
        workspaceId: entry.workspaceId,
      })),
    });

    return NextResponse.json(response);
  } catch {
    logServerError("Audit query failed");
    return internalError();
  }
}
