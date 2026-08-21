import { NextRequest, NextResponse } from 'next/server';
import { WBRResponseSchema } from '@/core/contracts';
import { gate } from '@/core/session-auth';
import { publicBaseUrl } from '@/core/view-state';
import { internalError, logServerError } from '@/core/errors';
import { loadWbrView } from '@/core/views/wbr';

/**
 * GET /api/v1/wbr
 *
 * Weekly Business Review metrics with exceptions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requested = searchParams.get('workspace') || 'demo';
    const gated = await gate(request, { workspace: requested, write: false });
    if (!gated.ok) return gated.response;
    const workspace = gated.workspace;

    const wbrData = await loadWbrView(workspace);

    const sections = Array.from(new Set((wbrData.metrics || []).map((m) => m.section)));
    const exceptionsCount = (wbrData.metrics || []).filter((m) => m.status !== 'ok').length;

    const metrics = (wbrData.metrics || []).map((m) => ({
      ...m,
      type: m.type === 'output' ? 'output' : 'input',
    }));

    const response = WBRResponseSchema.parse({
      metrics,
      proposals: wbrData.proposals || [],
      sections,
      exceptionsCount,
      workspace,
      view_url: `${publicBaseUrl(request)}/dashboard?workspace=${workspace}&view=wbr`
    });

    return NextResponse.json(response);
  } catch {
    logServerError('WBR query failed');
    return internalError();
  }
}
