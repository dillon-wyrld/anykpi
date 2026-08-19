import { NextRequest, NextResponse } from 'next/server';
import { CohortsResponseSchema } from '@/core/contracts';
import { authForwardHeaders, requireAuth } from '@/core/auth';
import { internalError, logServerError } from '@/core/errors';

/**
 * GET /api/v1/cohorts
 * 
 * Cohort retention with smile detection (PMF signal)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace') || 'demo';
    const denied = await requireAuth(request, { workspace, write: false });
    if (denied) return denied;
    
    const cohortData = await fetch(`${request.nextUrl.origin}/api/views/cohorts?workspace=${workspace}`, {
      headers: authForwardHeaders(request),
    }).then(r => r.json());
    
    const smileDetected = cohortData.cohorts?.some((c: any) => c.smileDetected) || false;
    
    const response = CohortsResponseSchema.parse({
      cohorts: cohortData.cohorts || [],
      smileDetected,
      workspace,
      view_url: `${request.nextUrl.origin}/dashboard?workspace=${workspace}&view=cohorts`
    });
    
    return NextResponse.json(response);
  } catch {
    logServerError('Cohorts query failed');
    return internalError();
  }
}
