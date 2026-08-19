import { NextRequest, NextResponse } from 'next/server';
import { CalendarResponseSchema } from '@/core/contracts';
import { authForwardHeaders, requireAuth } from '@/core/auth';
import { internalError, logServerError } from '@/core/errors';

/**
 * GET /api/v1/calendar
 * 
 * Calendar events from all connected sources
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace') || 'demo';
    const denied = await requireAuth(request, { workspace, write: false });
    if (denied) return denied;
    
    const calendarData = await fetch(`${request.nextUrl.origin}/api/views/calendar?workspace=${workspace}`, {
      headers: authForwardHeaders(request),
    }).then(r => r.json());
    
    const sources = Array.from(new Set((calendarData.events || []).map((e: any) => e.source)));
    
    const response = CalendarResponseSchema.parse({
      events: calendarData.events || [],
      sources,
      workspace,
      view_url: `${request.nextUrl.origin}/dashboard?workspace=${workspace}&view=calendar`
    });
    
    return NextResponse.json(response);
  } catch {
    logServerError('Calendar query failed');
    return internalError();
  }
}
