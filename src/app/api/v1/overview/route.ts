import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/core/db';
import * as schema from '@/core/schema';
import { eq } from 'drizzle-orm';
import { OverviewResponseSchema } from '@/core/contracts';
import { authForwardHeaders, requireAuth } from '@/core/auth';
import { internalError, logServerError } from '@/core/errors';

/**
 * GET /api/v1/overview
 * 
 * Company snapshot: users, activity, retention, exceptions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspace = searchParams.get('workspace') || 'demo';
    const denied = await requireAuth(request, { workspace, write: false });
    if (denied) return denied;
    const viewHeaders = authForwardHeaders(request);
    
    // Get user counts
    const users = await db.select().from(schema.users).where(eq(schema.users.workspaceId, workspace));
    const totalUsers = users.length;
    
    // Get today's activity
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
    
    // Get weekly active
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyActiveCount = new Set(
      activeToday
        .filter(a => a.timestamp >= weekAgo)
        .map(a => a.personId)
    ).size;
    
    // Check for smile (PMF signal)
    const cohortData = await fetch(`${request.nextUrl.origin}/api/views/cohorts?workspace=${workspace}`, { headers: viewHeaders }).then(r => r.json());
    const smileDetected = cohortData.cohorts?.some((c: any) => c.smileDetected) || false;
    
    // Get WBR exceptions
    const wbrData = await fetch(`${request.nextUrl.origin}/api/views/wbr?workspace=${workspace}`, { headers: viewHeaders }).then(r => r.json());
    const exceptionsCount = wbrData.metrics?.filter((m: any) => m.status !== 'ok').length || 0;
    
    // Get upcoming calendar events
    const calendarData = await fetch(`${request.nextUrl.origin}/api/views/calendar?workspace=${workspace}`, { headers: viewHeaders }).then(r => r.json());
    const upcomingEvents = calendarData.events?.filter((e: any) => e.isFuture).length || 0;
    
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
      view_url: `${request.nextUrl.origin}/dashboard?workspace=${workspace}&view=dotplot`
    });
    
    return NextResponse.json(response);
  } catch {
    logServerError('Overview query failed');
    return internalError();
  }
}
