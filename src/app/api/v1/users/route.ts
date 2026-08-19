import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/core/db';
import * as schema from '@/core/schema';
import { eq, and, gte, lte, sql, asc } from 'drizzle-orm';
import { QueryUsersRequestSchema, UsersListResponseSchema } from '@/core/contracts';
import { gate } from '@/core/auth';
import { ensureWorkspaceClusters } from '@/core/clustering';
import { publicBaseUrl } from '@/core/view-state';
import { badRequest, internalError, logServerError } from '@/core/errors';

/**
 * GET /api/v1/users
 *
 * Query users with filters: cluster, platform, signup dates.
 * `total` is a separate COUNT; page with `hasMore` / `nextOffset`.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('workspace') || 'demo';
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    await ensureWorkspaceClusters(workspace);

    const params = QueryUsersRequestSchema.parse({
      workspace,
      cluster: searchParams.get('cluster') || undefined,
      platform: searchParams.get('platform') || undefined,
      signupAfter: searchParams.get('signupAfter') || undefined,
      signupBefore: searchParams.get('signupBefore') || undefined,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100,
      offset: searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0,
    });

    const conditions = [eq(schema.users.workspaceId, params.workspace)];

    if (params.cluster) {
      conditions.push(eq(schema.users.cluster, params.cluster));
    }

    if (params.platform) {
      conditions.push(eq(schema.users.platform, params.platform));
    }

    if (params.signupAfter) {
      conditions.push(gte(schema.users.signupDate, new Date(params.signupAfter)));
    }

    if (params.signupBefore) {
      conditions.push(lte(schema.users.signupDate, new Date(params.signupBefore)));
    }

    const where = and(...conditions);

    const countRows = await db
      .select({ total: sql<number>`count(*)` })
      .from(schema.users)
      .where(where)
      .all();
    const total = Number(countRows[0]?.total ?? 0);

    const users = await db
      .select()
      .from(schema.users)
      .where(where)
      .orderBy(asc(schema.users.personId))
      .limit(params.limit)
      .offset(params.offset)
      .all();

    const hasMore = params.offset + users.length < total;
    const nextOffset = hasMore ? params.offset + users.length : null;

    const response = UsersListResponseSchema.parse({
      users: users.map(u => ({
        personId: u.personId,
        name: u.name,
        email: u.email || undefined,
        emoji: u.emoji || undefined,
        platform: u.platform || undefined,
        country: u.country || undefined,
        signupDate: u.signupDate?.toISOString(),
        cluster: u.cluster || undefined,
        accountId: u.accountId || undefined,
        workspaceId: u.workspaceId,
      })),
      total,
      hasMore,
      nextOffset,
      workspace: params.workspace,
      view_url: `${publicBaseUrl(request)}/dashboard?workspace=${params.workspace}&view=dotplot${params.cluster ? `&cluster=${params.cluster}` : ''}`
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return badRequest();
    }

    logServerError('Users query failed');
    return internalError();
  }
}
