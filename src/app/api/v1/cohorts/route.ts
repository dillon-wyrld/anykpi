import { NextRequest, NextResponse } from 'next/server';
import { CohortsResponseSchema } from '@/core/contracts';
import { gate } from '@/core/auth';
import { publicBaseUrl } from '@/core/view-state';
import { internalError, logServerError } from '@/core/errors';
import { loadCohortsView } from '@/core/views/cohorts';

/**
 * GET /api/v1/cohorts
 *
 * Cohort retention with smile detection (PMF signal)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('workspace') || 'demo';
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const cohortData = await loadCohortsView(workspace);
    const smileDetected = cohortData.cohorts?.some((c) => c.smileDetected) || false;

    const response = CohortsResponseSchema.parse({
      cohorts: (cohortData.cohorts || []).map((c) => ({
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
      })),
      smileDetected,
      workspace,
      view_url: `${publicBaseUrl(request)}/dashboard?workspace=${workspace}&view=cohorts`
    });

    return NextResponse.json(response);
  } catch {
    logServerError('Cohorts query failed');
    return internalError();
  }
}
