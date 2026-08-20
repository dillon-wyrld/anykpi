import { NextResponse } from "next/server";

/**
 * Machine-readable onboarding for agents.
 * GET /llms.txt
 *
 * Content is not exported — Next.js route modules may only export HTTP handlers.
 */
const LLMS_TXT = `# ANYKPI

> Self-hosted dashboard + REST API + CLI + MCP. Same resources humans see in the dashboard, agents fetch via API. Founder metrics: users, retention, PMF signals, WBR.

Demo workspace is public-read (seeded fictional people). Live workspaces and all writes require an API key. Webhook ingest is authenticated by a per-source HMAC secret instead of an API key.

## Auth

Send the key as \`Authorization: Bearer <key>\` or \`x-api-key: <key>\`.

Humans on a deployed instance can POST /api/session with the key once. That sets a signed httpOnly SameSite cookie so live dashboard views load without putting the key in a URL. DELETE /api/session logs out. Writes still require the key.

The first key comes from the operator: set ANYKPI_API_KEY in the environment, or mint an additional key in the UI (/connect or /agents) while presenting that operator key. There is deliberately no unauthenticated first-key endpoint.

Hashed keys are workspace-bound and carry a scope: read, write, or admin. New keys default to read. ANYKPI_API_KEY is admin. Existing keys migrate to write and show as legacy until \`anykpi keys downgrade\`. A read key on a write returns 403. In production, if ANYKPI_API_KEY is unset and no valid hashed key is presented, live reads and writes return 503.

## view_url

Successful overview, users, cohorts, WBR, and calendar responses include a view_url. It opens /dashboard in the workspace and view that prove the answer (for example /dashboard?workspace=demo&view=dotplot). Origin is the request Host / X-Forwarded-* unless PUBLIC_BASE_URL is set.

## REST

OpenAPI spec: /api/openapi

- GET /api/v1/overview — company snapshot (users, activity, retention, PMF signal, exceptions)
- GET /api/v1/users — query users (cluster, platform, signup dates, limit, offset; total + hasMore + nextOffset)
- GET /api/v1/cohorts — retention curves with smile detection; optional split by platform, country, or cluster (max 3 series)
- GET /api/v1/wbr — Weekly Business Review (6 weeks, 12 months YOY, exceptions)
- GET /api/v1/calendar — multi-source event timeline
- GET /api/v1/sync — connector sync status
- GET /api/v1/freshness — last ingest + per-source last-sync stamps (views poll this)
- POST /api/v1/connect — store per-source credentials (encrypted at rest; never returned; csv stores import mapping)
- POST /api/v1/import — CSV import for users and events (sources store + column-mapping preview; writes keyed)
- GET /api/v1/keys — list key metadata (scope, lastUsedAt, legacy; raw keys never returned)
- POST /api/v1/keys — mint a key (defaults to read; requires an existing operator or hashed key; raw key returned once)
- POST /api/v1/keys/downgrade — convert legacy write keys to read (\`anykpi keys downgrade\`)
- POST /api/v1/ingest/identify — create or update a user
- POST /api/v1/ingest/event — track an activity event
- POST /api/ingest/batch — batch track (up to 1k events; duplicates no-op on externalId)

Realtime push (HMAC, not an API key): POST /api/ingest/webhook/{source} — see docs/webhooks.md.

Default query workspace is demo. Ingest and key writes always require a key.

## MCP

HTTP endpoint: POST /api/mcp (JSON-RPC). tools/list is unauthenticated. tools/call uses the same auth as REST: demo reads allowed without a key; live reads and writes require a key.

Tools:

- \`get_overview\` — snapshot: headline metrics, exception count, sync health
- \`query_users\` — filter users (platform, country, limit)
- \`get_cohorts\` — retention, smile flags, PMF verdict; optional split (max 3 series)
- \`get_wbr\` — WBR metrics and exception sentences
- \`get_calendar\` — events in range by source
- \`install_sdk\` — SDK snippet for a web app (stdio MCP)
- \`configure_value_events\` — map event names to classes core/search/share/pay (stdio MCP; requires write scope)

stdio server: src/mcp/server.ts. HTTP tools/list advertises the five read tools above.

## CLI

npx @anykpi/cli

Commands: login (alias: key), keys, workspaces, connect, import, identify, track, overview, users, cohorts, wbr, calendar, sync.

login mints a key via POST /api/v1/keys (default scope read; pass --scope write for ingest) and requires ANYKPI_API_KEY or --key. keys lists metadata (scope, last used, legacy). \`anykpi keys downgrade\` converts migrated write keys to read. connect stores source credentials via POST /api/v1/connect (including \`anykpi connect csv\`). import uploads a users or events CSV via POST /api/v1/import. Query commands take --workspace and --json.

## Connectors

Shipped: PostHog, Mixpanel, Amplitude, Stripe, RevenueCat, Mercury, ICS. Sync is pull-only into local read models; ANYKPI never writes back. Stripe also accepts a signature-verified webhook at POST /api/webhooks/stripe so revenue stays minutes-fresh. Connector setup is the /connect UI or \`anykpi connect\`. Config is encrypted at rest with ANYKPI_SECRET. Env vars are a deprecated read-only fallback. Calendar ICS is read-only forever.

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
