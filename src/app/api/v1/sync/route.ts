import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/core/db';
import * as schema from '@/core/schema';
import { eq } from 'drizzle-orm';
import { SyncResponseSchema } from '@/core/contracts';
import { gate } from '@/core/auth';
import { internalError, logServerError } from '@/core/errors';

/**
 * GET /api/v1/sync
 * 
 * Sync state for all connected sources
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('workspace') || 'demo';
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;
    
    const syncStates = await db
      .select()
      .from(schema.syncState)
      .where(eq(schema.syncState.workspaceId, workspace))
      .all();
    
    const response = SyncResponseSchema.parse({
      states: syncStates.map(s => ({
        source: s.source,
        sourceName: s.sourceName,
        lastSync: s.lastSync?.toISOString(),
        status: s.status as 'success' | 'error' | 'pending',
        error: s.error || undefined,
      })),
      workspace,
    });
    
    return NextResponse.json(response);
  } catch {
    logServerError('Sync query failed');
    return internalError();
  }
}
