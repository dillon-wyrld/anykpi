import { NextRequest, NextResponse } from 'next/server';
import { CalendarResponseSchema } from '@/core/contracts';
import { gate } from '@/core/session-auth';
import { publicBaseUrl } from '@/core/view-state';
import { internalError, logServerError } from '@/core/errors';
import { loadCalendarView } from '@/core/views/calendar';

/**
 * GET /api/v1/calendar
 *
 * Calendar events from all connected sources
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('workspace') || 'demo';
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const calendarData = await loadCalendarView(workspace);

    const events = (calendarData.events || []).map((e) => ({
      id: e.id,
      source: e.source,
      sourceName: e.sourceName,
      sourceColor: e.sourceColor,
      type: e.type,
      emoji: e.sourceGlyph,
      title: e.title,
      badge: e.badge,
      date: e.date,
      isFuture: Boolean(e.isFuture),
      syncAge: e.syncAge,
    }));

    const sources = Array.from(new Set(events.map((e) => e.source)));

    const response = CalendarResponseSchema.parse({
      events,
      sources,
      workspace,
      view_url: `${publicBaseUrl(request)}/dashboard?workspace=${workspace}&view=calendar`
    });

    return NextResponse.json(response);
  } catch {
    logServerError('Calendar query failed');
    return internalError();
  }
}
