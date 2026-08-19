import { NextRequest, NextResponse } from 'next/server';
import { WBRResponseSchema } from '@/core/contracts';

/**
 * GET /api/v1/wbr
 * 
 * Weekly Business Review metrics with exceptions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace') || 'demo';
    
    // Reuse existing WBR view logic
    const wbrData = await fetch(`${request.nextUrl.origin}/api/views/wbr?workspace=${workspace}`).then(r => r.json());
    
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
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error', statusCode: 500 },
      { status: 500 }
    );
  }
}
