import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/core/db';
import * as schema from '@/core/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { QueryUsersRequestSchema, UsersListResponseSchema } from '@/core/contracts';

/**
 * GET /api/v1/users
 * 
 * Query users with filters: cluster, platform, signup dates
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const params = QueryUsersRequestSchema.parse({
      workspace: searchParams.get('workspace') || 'demo',
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
    
    const users = await db
      .select()
      .from(schema.users)
      .where(and(...conditions))
      .limit(params.limit)
      .offset(params.offset)
      .all();
    
    const total = users.length; // TODO: separate count query for pagination
    
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
      workspace: params.workspace,
      view_url: `${request.nextUrl.origin}/dashboard?workspace=${params.workspace}&view=dotplot${params.cluster ? `&cluster=${params.cluster}` : ''}`
    });
    
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error && error.message.includes('parse')) {
      return NextResponse.json(
        { error: 'Bad Request', message: error.message, statusCode: 400 },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal Server Error', message: error instanceof Error ? error.message : 'Unknown error', statusCode: 500 },
      { status: 500 }
    );
  }
}
