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

- GET /api/v1/overview — company snapshot (users, activity, retention, PMF signal, exceptions, syncHealth)
- GET /api/v1/users — query users (cluster, platform, signup dates, limit, offset; total + hasMore + nextOffset)
- DELETE /api/v1/users/{id} — purge a person, cascade read models, and write a tombstone so re-sync cannot resurrect them (key-only; a browser session is 403)
- GET /api/v1/cohorts — retention curves with smile detection; optional split by platform, country, or cluster (max 3 series)
- GET /api/v1/wbr — Weekly Business Review (6 weeks, 12 months YOY, exceptions)
- GET /api/v1/calendar — multi-source event timeline
- GET /api/v1/sync — connector sync status (includes syncIntervalMinutes)
- GET /api/v1/freshness — last ingest + per-source last-sync stamps (views poll this)
- GET /api/v1/audit — action log (actor, action, subject, timestamp). Filter by actor and since to ask what an agent did yesterday
- GET /api/v1/outreach — persisted PMF+ outreach drafts
- POST /api/v1/outreach — queue a waiting draft (write scope)
- POST /api/v1/outreach/approve — approve a draft (browser session or admin key only; a write key cannot approve)
- POST /api/v1/outreach/send — deliver an approved draft (unapproved drafts are refused)
- POST /api/v1/outreach/outcome — tag replied / interviewed / converted (PMF+ conversion by cluster)
- POST /api/v1/connect — store per-source credentials (encrypted at rest; never returned; csv stores import mapping)
- POST /api/v1/import — CSV import for users and events (sources store + column-mapping preview; writes keyed)
- GET /api/v1/export — users, events, and read models as JSON or CSV files (connector read models restore by re-sync)
- GET /api/v1/workspaces — catalog of named workspaces (id, name, archivedAt)
- POST /api/v1/workspaces — create a live workspace (admin / env key)
- PATCH /api/v1/workspaces — archive a live workspace (admin / env key; demo cannot be archived)
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
- \`connect_source\` — store per-source credentials encrypted at rest (requires write scope)
- \`trigger_sync\` — run a connector sync for one source or all (requires write scope)
- \`import_csv\` — import users or events from CSV (requires write scope)
- \`queue_outreach\` — persist a waiting draft (write scope)
- \`approve_outreach\` — approve a persisted draft (session or admin only)
- \`send_outreach\` — deliver an approved draft; unapproved drafts are refused
- \`install_sdk\` — SDK snippet for a web app (stdio MCP)
- \`configure_value_events\` — map event names to classes core/search/share/pay (stdio MCP; requires write scope)

stdio server: src/mcp/server.ts. HTTP tools/list advertises the five read tools, the three ANY-28 write tools, and outreach queue/approve/send.

## CLI

npx @anykpi/cli

Commands: login (alias: key), keys, workspaces, connect, import, export, identify, track, overview, users, cohorts, wbr, calendar, sync, outreach.

login mints a key via POST /api/v1/keys (default scope read; pass --scope write for ingest) and requires ANYKPI_API_KEY or --key. keys lists metadata (scope, last used, legacy). \`anykpi keys downgrade\` converts migrated write keys to read. connect stores source credentials via POST /api/v1/connect (including \`anykpi connect csv\`). import uploads a users or events CSV via POST /api/v1/import. export writes users, events, and read models via GET /api/v1/export (docs/backup.md). outreach lists drafts or tags \`--outcome replied|interviewed|converted\`. Query commands take --workspace and --json.

## Connectors

Shipped: PostHog, Mixpanel, Amplitude, Stripe, RevenueCat, Mercury, ICS, GitHub. Sync is pull-only into local read models; ANYKPI never writes back. Stripe also accepts a signature-verified webhook at POST /api/webhooks/stripe so revenue stays minutes-fresh. Connector setup is the /connect UI or \`anykpi connect\`. /connect shows last sync, rows pulled, next run (SYNC_INTERVAL_MINUTES), a plain-language error with a next step, and Sync now. Config is encrypted at rest with ANYKPI_SECRET. Env vars are a deprecated read-only fallback. Calendar ICS is read-only forever. The Node process pulls connected sources every SYNC_INTERVAL_MINUTES (default 15) from instrumentation.ts. Set 0 and POST /api/v1/sync from cron — see docs/cron.md.

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
