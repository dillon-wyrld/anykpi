# AGENTS.md

Guidance for coding agents working in this repository.

ANYKPI is a self-hosted dashboard + REST API + CLI + MCP. Humans and agents see the same resources. Founder metrics: users, retention, PMF signals, WBR.

A running instance serves the same facts at `/llms.txt`.

## Bootstrap

```bash
pnpm install
pnpm db:init   # SQLite at DATABASE_PATH (default ./data/anykpi.db); seeds demo
pnpm dev       # http://localhost:3000
```

The first API key comes from the operator: set `ANYKPI_API_KEY` in the environment (see `.env.example`), or mint an additional key in the UI at `/connect` or `/agents` while presenting that operator key. There is deliberately no unauthenticated first-key endpoint.

Demo workspace is public-read. Live workspaces require a key (`Authorization: Bearer` or `x-api-key`) or a signed browser session cookie from `POST /api/session`. Writes stay key-only.

## REST

`/api/v1/*`. OpenAPI at `/api/openapi`.

- `GET /api/v1/overview` — company snapshot (includes connector `syncHealth`)
- `GET /api/v1/users` — query users (cluster, platform, dates, limit, offset)
- `DELETE /api/v1/users/{id}` — purge a person and write a tombstone (key-only; survives re-sync)
- `GET /api/v1/cohorts` — retention with smile detection; optional `split` by platform, country, or cluster (max 3 series)
- `GET /api/v1/wbr` — Weekly Business Review
- `GET /api/v1/calendar` — multi-source timeline
- `GET /api/v1/sync` — connector status (`syncIntervalMinutes` from `SYNC_INTERVAL_MINUTES`)
- `GET /api/v1/freshness` — last ingest + per-source last-sync stamps
- `GET /api/v1/audit` — action audit log (actor, action, subject, timestamp)
- `GET /api/v1/outreach` — persisted PMF+ outreach drafts
- `POST /api/v1/outreach` — queue a waiting draft (write scope)
- `POST /api/v1/outreach/approve` — approve a draft (browser session or admin key; write cannot approve)
- `POST /api/v1/outreach/send` — deliver an approved draft (unapproved drafts are refused)
- `POST /api/v1/outreach/outcome` — tag replied / interviewed / converted (stored in config; PMF+ shows conversion by cluster)
- `POST /api/v1/connect` — store per-source credentials (encrypted at rest; source `csv` stores import mapping)
- `POST /api/v1/import` — CSV import for users and events (uses the sources store; column-mapping preview)
- `GET /api/v1/export` — users, events, and read models as JSON or CSV files
- `GET /api/v1/workspaces` — catalog (id, name, archivedAt) for the switcher
- `POST /api/v1/workspaces` — create a live workspace (admin / env key)
- `PATCH /api/v1/workspaces` — archive a live workspace (admin / env key; demo cannot be archived)
- `GET /api/v1/keys` / `POST /api/v1/keys` — list metadata (scope, last used, legacy) / mint a key (default read)
- `POST /api/v1/keys/downgrade` — convert legacy write keys to read
- `POST /api/v1/ingest/identify` / `POST /api/v1/ingest/event` — identify and track
- `POST /api/ingest/batch` — batch track (up to 1k events; idempotent on activity.externalId)
- `POST /api/ingest/webhook/:source` — realtime push; HMAC secret stored via connect
- `POST /api/session` / `GET /api/session` / `DELETE /api/session` — browser session cookie for live dashboard reads (httpOnly + SameSite; writes stay key-only)

## MCP

HTTP `POST /api/mcp`. stdio: `src/mcp/server.ts`. `tools/list` is open. `tools/call` follows REST auth.

- `get_overview`, `query_users`, `get_cohorts`, `get_wbr`, `get_calendar`
- write (requires write scope): `connect_source`, `trigger_sync`, `import_csv`
- `queue_outreach`, `approve_outreach`, `send_outreach` (HTTP MCP; write can queue, only session/admin can approve, unapproved send is refused)
- stdio also: `install_sdk`, `configure_value_events` (requires write scope)

## CLI

`npx @anykpi/cli` (`packages/cli`): `login` (alias `key`), `keys`, `workspaces`, `connect`, `import`, `export`, `identify`, `track`, `overview`, `users`, `cohorts`, `wbr`, `calendar`, `sync`, `outreach`. `login` requires an operator key and mints read by default (`--scope write` for ingest). `anykpi keys downgrade` converts legacy write keys to read. `connect` stores source config only (`anykpi connect csv` saves import mapping). `import` loads a users or events CSV. `export` writes JSON or CSV of users, events, and read models (`docs/backup.md`). `outreach` lists drafts or tags `--outcome replied|interviewed|converted`.

## Connectors

Shipped: PostHog, Mixpanel, Amplitude, Stripe, RevenueCat, Mercury, ICS, GitHub. Pull-only (Stripe also accepts a signature-verified webhook at `POST /api/webhooks/stripe`). Connector setup is the `/connect` UI or `anykpi connect`. `/connect` shows last sync, rows pulled, next run (`SYNC_INTERVAL_MINUTES`), a plain-language error with a next step, and Sync now. Config is encrypted at rest with `ANYKPI_SECRET`. Env vars are a deprecated read-only fallback. Calendar ICS is read-only forever.

## view_url

Read responses include a view_url that opens `/dashboard` in the workspace and view that prove the answer, e.g. `/dashboard?workspace=demo&view=dotplot`. Origin comes from `Host` / `X-Forwarded-*` unless `PUBLIC_BASE_URL` is set.

## Layout

- `src/app/api` — HTTP routes (REST, MCP, views, OpenAPI, `/llms.txt`)
- `src/instrumentation.ts` — process-lifetime scheduled refresh (`SYNC_INTERVAL_MINUTES`, default 15; `0` + `POST /api/v1/sync` for external cron, see `docs/cron.md`)
- `src/core` — auth, Zod contracts, view-state, read-model loaders, export, `anykpi.config.json` loader (WBR exception thresholds beside the database)
- `src/mcp/server.ts` — stdio MCP server
- `src/connectors` — PostHog, Mixpanel, Amplitude, Stripe, RevenueCat, Mercury, ICS, GitHub
- `src/demo` — canonical demo dataset
- `packages/cli` — CLI
- `docs/introduction.md` — human docs
- `docs/webhooks.md` — webhook-in recipes
- `docs/backup.md` — `anykpi export` and SQLite snapshot

Do not invent routes or tools. The OpenAPI spec and MCP tools list are the source of truth. `spec/` is design history, not the shipped surface.

## Verify

CI gates on:

```bash
pnpm tsc --noEmit
pnpm lint
pnpm test:unit
pnpm build
pnpm test:e2e
```

## Constraints

- Never weaken authentication. Only `demo` is public-read.
- Calendar is read-only. Nothing sends on its own. No telemetry.
- PMF+ web research runs only from an explicit per-user approve action. No background egress. Results cache in `research-cache.json` beside the database.
- Validate inputs with Zod contracts in `src/core/contracts.ts`.
- TypeScript strict mode is on.
- Public copy: no internal briefs, no comparison to other products by name, no personal names.
