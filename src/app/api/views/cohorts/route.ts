import { NextRequest, NextResponse } from "next/server";
import { gate } from "@/core/session-auth";
import { badRequest, internalError, logServerError } from "@/core/errors";
import {
  CohortCompareError,
  loadCohortsView,
  parseCohortCompareOptions,
} from "@/core/views/cohorts";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const requested = searchParams.get("workspace") || "demo";
  const grainParam = searchParams.get("grain") || "week";
  const payers =
    searchParams.get("payers") === "1" || searchParams.get("payers") === "true";
  const gated = await gate(request, { workspace: requested, write: false });
  if (!gated.ok) return gated.response;

  try {
    const compare = parseCohortCompareOptions({
      split: searchParams.get("split"),
      series: searchParams.get("series"),
    });
    return NextResponse.json(
      await loadCohortsView(gated.workspace, grainParam, {
        payers,
        split: compare.split,
        series: compare.series,
      })
    );
  } catch (error) {
    if (error instanceof CohortCompareError) {
      return badRequest(error.message);
    }
    logServerError("Cohorts view failed");
    return internalError();
  }
}
