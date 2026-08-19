import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/core/auth";
import { internalError, logServerError } from "@/core/errors";
import { demoPmfRuns } from "@/core/views/pmf";

/**
 * PMF+ View API
 *
 * Returns simulated research runs with persona findings.
 * For demo workspace, shows pre-generated cards.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("workspace") || "demo";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;
  const workspace = gated.workspace;

  try {
    if (workspace === "demo") {
      return NextResponse.json({ runs: demoPmfRuns() });
    }

    // For live workspace, return empty (no auto-research without explicit trigger)
    return NextResponse.json({ runs: [] });
  } catch {
    logServerError("PMF view failed");
    return internalError();
  }
}
