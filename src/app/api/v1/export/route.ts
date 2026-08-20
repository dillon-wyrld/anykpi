import { NextRequest, NextResponse } from "next/server";
import { ExportFormatSchema, ExportResponseSchema } from "@/core/contracts";
import { gate } from "@/core/auth";
import { badRequest, internalError, logServerError } from "@/core/errors";
import { exportWorkspace, formatExport } from "@/core/export";
import { publicBaseUrl } from "@/core/view-state";

/**
 * GET /api/v1/export
 *
 * Full workspace dump: users, events, and read models as JSON or CSV files.
 * Read-gated. Demo is public-read.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get("workspace") || "demo";
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const formatParsed = ExportFormatSchema.safeParse(searchParams.get("format") || "json");
    if (!formatParsed.success) {
      return badRequest("format must be json or csv");
    }

    const bundle = await exportWorkspace(workspace);
    const envelope = formatExport(bundle, formatParsed.data);

    const response = ExportResponseSchema.parse({
      ...envelope,
      view_url: `${publicBaseUrl(request)}/dashboard?workspace=${workspace}&view=dotplot`,
    });

    return NextResponse.json(response);
  } catch {
    logServerError("Workspace export failed");
    return internalError();
  }
}
