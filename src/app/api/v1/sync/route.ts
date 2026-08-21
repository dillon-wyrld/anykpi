import { NextRequest, NextResponse } from 'next/server';
import {
  SyncResponseSchema,
  SyncTriggerRequestSchema,
  SyncTriggerResponseSchema,
} from '@/core/contracts';
import { AUDIT_ACTIONS, recordWriteAudit } from '@/core/audit';
import { gate } from '@/core/session-auth';
import {
  badRequest,
  internalError,
  logServerError,
  PayloadTooLargeError,
  payloadTooLarge,
  readJsonBounded,
} from '@/core/errors';
import { getConnector, resolveSources, sync } from '@/connectors';
import { parseSyncIntervalMinutes } from '@/core/scheduler-env';
import { loadWorkspaceSyncStates } from '@/core/sync-health';

async function loadStates(workspace: string) {
  return loadWorkspaceSyncStates(workspace);
}

/**
 * GET /api/v1/sync
 *
 * Sync state for all connected sources. Demo stays public-read.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('workspace') || 'demo';
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const response = SyncResponseSchema.parse({
      states: await loadStates(workspace),
      workspace,
      syncIntervalMinutes: parseSyncIntervalMinutes(),
    });

    return NextResponse.json(response);
  } catch {
    logServerError('Sync query failed');
    return internalError();
  }
}

/**
 * POST /api/v1/sync
 *
 * Trigger a connector sync for one source or all registered sources.
 * Write-gated: an API key is required, including for the demo workspace.
 */
export async function POST(request: NextRequest) {
  try {
    let raw: unknown = {};
    try {
      raw = await readJsonBounded(request);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return payloadTooLarge();
      if (error instanceof SyntaxError) return badRequest('Invalid JSON body');
      throw error;
    }

    const parsed = SyncTriggerRequestSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return badRequest();
    }

    const { searchParams } = new URL(request.url);
    const requested =
      parsed.data.workspace || searchParams.get('workspace') || 'live';
    const gated = await gate(request, { workspace: requested, write: true });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const sourceArg = parsed.data.source ?? searchParams.get('source');
    const sources = resolveSources(sourceArg);

    for (const source of sources) {
      if (!getConnector(source)) {
        return badRequest(`Unknown connector source: ${source}`);
      }
    }

    const results = await Promise.all(
      sources.map(async (source) => {
        const result = await sync(source, workspace);
        return { source, ...result };
      })
    );

    await recordWriteAudit(
      gated.auth,
      workspace,
      AUDIT_ACTIONS.syncTrigger,
      sourceArg ?? 'all'
    );

    const response = SyncTriggerResponseSchema.parse({
      results,
      states: await loadStates(workspace),
      workspace,
    });

    return NextResponse.json(response);
  } catch {
    logServerError('Sync trigger failed');
    return internalError();
  }
}
