import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/core/db';
import * as schema from '@/core/schema';
import { eq } from 'drizzle-orm';
import { OverviewResponseSchema } from '@/core/contracts';
import { gate } from '@/core/auth';
import { publicBaseUrl } from '@/core/view-state';
import { internalError, logServerError } from '@/core/errors';
import { loadCohortsView } from '@/core/views/cohorts';
import { loadWbrView } from '@/core/views/wbr';
import { loadCalendarView } from '@/core/views/calendar';

/**
 * GET /api/v1/overview
 *
 * Company snapshot: users, activity, retention, exceptions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('workspace') || 'demo';
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const users = await db.select().from(schema.users).where(eq(schema.users.workspaceId, workspace));
    const totalUsers = users.length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeToday = await db
      .select()
      .from(schema.activity)
      .where(eq(schema.activity.workspaceId, workspace))
      .all();

    const activeTodayCount = new Set(
      activeToday
        .filter(a => a.timestamp >= today)
        .map(a => a.personId)
    ).size;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyActiveCount = new Set(
      activeToday
        .filter(a => a.timestamp >= weekAgo)
        .map(a => a.personId)
    ).size;

    const cohortData = await loadCohortsView(workspace);
    const smileDetected = cohortData.cohorts?.some((c) => c.smileDetected) || false;

    const wbrData = await loadWbrView(workspace);
    const exceptionsCount = wbrData.metrics?.filter((m) => m.status !== 'ok').length || 0;

    const calendarData = await loadCalendarView(workspace);
    const upcomingEvents = calendarData.events?.filter((e) => e.isFuture).length || 0;

    const retentionRate = weeklyActiveCount > 0 ? Math.round((weeklyActiveCount / totalUsers) * 100) : 0;

    const response = OverviewResponseSchema.parse({
      workspace,
      totalUsers,
      activeToday: activeTodayCount,
      weeklyActive: weeklyActiveCount,
      retentionRate,
      smileDetected,
      exceptionsCount,
      upcomingEvents,
      view_url: `${publicBaseUrl(request)}/dashboard?workspace=${workspace}&view=dotplot`
    });

    return NextResponse.json(response);
  } catch {
    logServerError('Overview query failed');
    return internalError();
  }
}
