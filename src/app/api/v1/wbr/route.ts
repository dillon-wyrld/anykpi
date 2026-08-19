import { NextRequest, NextResponse } from 'next/server';
import { WBRResponseSchema } from '@/core/contracts';
import { authForwardHeaders, requireAuth } from '@/core/auth';
import { internalError, logServerError } from '@/core/errors';

/**
 * GET /api/v1/wbr
 * 
 * Weekly Business Review metrics with exceptions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace') || 'demo';
    const denied = await requireAuth(request, { workspace, write: false });
    if (denied) return denied;
    
    const wbrData = await fetch(`${request.nextUrl.origin}/api/views/wbr?workspace=${workspace}`, {
      headers: authForwardHeaders(request),
    }).then(r => r.json());
    
    const sections = Array.from(new Set((wbrData.metrics || []).map((m: any) => m.section)));
    const exceptionsCount = (wbrData.metrics || []).filter((m: any) => m.status !== 'ok').length;
    
    const response = WBRResponseSchema.parse({
      metrics: wbrData.metrics || [],
      sections,
      exceptionsCount,
      workspace,
      view_url: `${request.nextUrl.origin}/dashboard?workspace=${workspace}&view=wbr`
    });
    
    return NextResponse.json(response);
  } catch {
    logServerError('WBR query failed');
    return internalError();
  }
}
