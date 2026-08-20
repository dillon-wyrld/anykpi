import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/core/session-auth";
import { internalError, logServerError } from "@/core/errors";
import { loadFreshness } from "@/core/freshness";

/**
 * GET /api/v1/freshness
 *
 * Last ingest + per-source last-sync stamps. Demo stays public-read.
 * Dashboard views poll this and refetch only when a watched stamp moves.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get("workspace") || "demo";
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;

    const response = await loadFreshness(gated.workspace);
    return NextResponse.json(response);
  } catch {
    logServerError("Freshness query failed");
    return internalError();
  }
}
