import { NextRequest, NextResponse } from "next/server";
import { CohortsResponseSchema } from "@/core/contracts";
import { gate } from "@/core/session-auth";
import { publicBaseUrl } from "@/core/view-state";
import { badRequest, internalError, logServerError } from "@/core/errors";
import {
  CohortCompareError,
  cohortsDashboardQuery,
  loadCohortsView,
  parseCohortCompareOptions,
} from "@/core/views/cohorts";

function toApiCohort(c: {
  label: string;
  size: number;
  retention: number[];
  smileDetected: boolean;
}) {
  return {
    cohort: c.label,
    label: c.label,
    size: c.size,
    weeks: c.retention,
    smileDetected: c.smileDetected,
    retention: {
      week0: c.retention[0] ?? 0,
      week4: c.retention[4] ?? 0,
      latest: c.retention[c.retention.length - 1] ?? 0,
    },
  };
}

/**
 * GET /api/v1/cohorts
 *
 * Cohort retention with smile detection (PMF signal).
 * Optional `split` (platform | country | cluster) draws up to 3 series.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get("workspace") || "demo";
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const payers =
      searchParams.get("payers") === "1" || searchParams.get("payers") === "true";
    const compare = parseCohortCompareOptions({
      split: searchParams.get("split"),
      series: searchParams.get("series"),
    });
    const cohortData = await loadCohortsView(workspace, "week", {
      payers,
      split: compare.split,
      series: compare.series,
    });
    const smileDetected = cohortData.cohorts?.some((c) => c.smileDetected) || false;

    const response = CohortsResponseSchema.parse({
      cohorts: (cohortData.cohorts || []).map(toApiCohort),
      smileDetected,
      workspace,
      split: cohortData.split,
      series: (cohortData.series || []).map((s) => ({
        key: s.key,
        size: s.size,
        cohorts: s.cohorts.map(toApiCohort),
      })),
      view_url: `${publicBaseUrl(request)}/dashboard?${cohortsDashboardQuery({
        workspace,
        payers,
        split: cohortData.split,
        series: compare.series.length > 0 ? compare.series : undefined,
      })}`,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof CohortCompareError) {
      return badRequest(error.message);
    }
    logServerError("Cohorts query failed");
    return internalError();
  }
}
