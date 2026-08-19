import { NextRequest, NextResponse } from 'next/server';
import { CalendarResponseSchema } from '@/core/contracts';

/**
 * GET /api/v1/calendar
 * 
 * Calendar events from all connected sources
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace') || 'demo';
    
    // Reuse existing calendar view logic
    const calendarData = await fetch(`${request.nextUrl.origin}/api/views/calendar?workspace=${workspace}`).then(r => r.json());
    
    const sources = Array.from(new Set((calendarData.events || []).map((e: any) => e.source)));
    
    const response = CalendarResponseSchema.parse({
      events: calendarData.events || [],
      sources,
      workspace,
      view_url: `${request.nextUrl.origin}/dashboard?workspace=${workspace}&view=calendar`
    });
    
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error', statusCode: 500 },
      { status: 500 }
    );
  }
}
