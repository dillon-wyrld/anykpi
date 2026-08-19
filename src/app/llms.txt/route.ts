import { NextResponse } from "next/server";

/**
 * Machine-readable onboarding for agents.
 * GET /llms.txt
 *
 * Content is not exported — Next.js route modules may only export HTTP handlers.
 */
const LLMS_TXT = `# ANYKPI

> Self-hosted dashboard + REST API + CLI + MCP. Same resources humans see in the dashboard, agents fetch via API. Founder metrics: users, retention, PMF signals, WBR.

Demo workspace is public-read (seeded fictional people). Live workspaces and all writes require an API key.

## Auth

Send the key as \`Authorization: Bearer <key>\` or \`x-api-key: <key>\`.

The first key comes from the operator: set ANYKPI_API_KEY in the environment, or mint an additional key in the UI (/connect or /agents) while presenting that operator key. There is deliberately no unauthenticated first-key endpoint.

Hashed keys are workspace-bound. The env operator key may choose a workspace. In production, if ANYKPI_API_KEY is unset and no valid hashed key is presented, live reads and writes return 503.

## view_url

Successful overview, users, cohorts, WBR, and calendar responses include a view_url. It opens /dashboard in the workspace and view that prove the answer (for example /dashboard?workspace=demo&view=dotplot). Origin is the request Host / X-Forwarded-* unless PUBLIC_BASE_URL is set.

## REST

OpenAPI spec: /api/openapi

- GET /api/v1/overview — company snapshot (users, activity, retention, PMF signal, exceptions)
- GET /api/v1/users — query users (cluster, platform, signup dates, limit, offset; total + hasMore + nextOffset)
- GET /api/v1/cohorts — retention curves with smile detection
- GET /api/v1/wbr — Weekly Business Review (6 weeks, 12 months YOY, exceptions)
- GET /api/v1/calendar — multi-source event timeline
- GET /api/v1/sync — connector sync status
- POST /api/v1/connect — store per-source credentials (encrypted at rest; never returned)
- GET /api/v1/keys — list key metadata (raw keys never returned)
- POST /api/v1/keys — mint a key (requires an existing operator or hashed key; raw key returned once)
- POST /api/v1/ingest/identify — create or update a user
- POST /api/v1/ingest/event — track an activity event

Default query workspace is demo. Ingest and key writes always require a key.

## MCP

HTTP endpoint: POST /api/mcp (JSON-RPC). tools/list is unauthenticated. tools/call uses the same auth as REST: demo reads allowed without a key; live reads and writes require a key.

Tools:

- \`get_overview\` — snapshot: headline metrics, exception count, sync health
- \`query_users\` — filter users (platform, country, limit)
- \`get_cohorts\` — retention, smile flags, PMF verdict
- \`get_wbr\` — WBR metrics and exception sentences
- \`get_calendar\` — events in range by source
- \`install_sdk\` — SDK snippet for a web app (stdio MCP)
- \`configure_value_events\` — map event names to classes core/search/share/pay (stdio MCP; write)

stdio server: src/mcp/server.ts. HTTP tools/list advertises the five read tools above.

## CLI

npx @anykpi/cli

Commands: login (alias: key), workspaces, connect, identify, track, overview, users, cohorts, wbr, calendar, sync.

login mints a key via POST /api/v1/keys and requires ANYKPI_API_KEY or --key. connect stores source credentials via POST /api/v1/connect. Query commands take --workspace and --json.

## Connectors

Shipped: PostHog, Mixpanel, Amplitude. Sync is pull-only into local read models; ANYKPI never writes back. Connector setup is the /connect UI or \`anykpi connect\`. Config is encrypted at rest with ANYKPI_SECRET. Env vars are a deprecated read-only fallback.

## More

Repo AGENTS.md (clone onboarding). Docs: docs/introduction.md. Dashboard: /dashboard. Five views: dotplot, cohorts, wbr, calendar, pmf.
`;

export async function GET() {
  return new NextResponse(LLMS_TXT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
