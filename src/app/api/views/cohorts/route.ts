import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/core/auth";
import { internalError, logServerError } from "@/core/errors";
import { loadCohortsView } from "@/core/views/cohorts";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requested = searchParams.get("workspace") || "demo";
  const grainParam = searchParams.get("grain") || "week";
  const payers =
    searchParams.get("payers") === "1" || searchParams.get("payers") === "true";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;

  try {
    return NextResponse.json(
      await loadCohortsView(gated.workspace, grainParam, { payers })
    );
  } catch {
    logServerError("Cohorts view failed");
    return internalError();
  }
}
