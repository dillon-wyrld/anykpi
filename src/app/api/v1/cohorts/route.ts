import { NextRequest, NextResponse } from 'next/server';
import { CohortsResponseSchema } from '@/core/contracts';

/**
 * GET /api/v1/cohorts
 * 
 * Cohort retention with smile detection (PMF signal)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace') || 'demo';
    
    // Reuse existing cohorts view logic
    const cohortData = await fetch(`${request.nextUrl.origin}/api/views/cohorts?workspace=${workspace}`).then(r => r.json());
    
    const smileDetected = cohortData.cohorts?.some((c: any) => c.smileDetected) || false;
    
    const response = CohortsResponseSchema.parse({
      cohorts: cohortData.cohorts || [],
      smileDetected,
      workspace,
      view_url: `${request.nextUrl.origin}/dashboard?workspace=${workspace}&view=cohorts`
    });
    
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error', statusCode: 500 },
      { status: 500 }
    );
  }
}
