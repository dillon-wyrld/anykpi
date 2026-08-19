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

Demo workspace is public-read. Live workspaces and all writes require a key (`Authorization: Bearer` or `x-api-key`).

## REST

`/api/v1/*`. OpenAPI at `/api/openapi`.

- `GET /api/v1/overview` — company snapshot
- `GET /api/v1/users` — query users (cluster, platform, dates, limit, offset)
- `GET /api/v1/cohorts` — retention with smile detection; optional `split` by platform, country, or cluster (max 3 series)
- `GET /api/v1/wbr` — Weekly Business Review
- `GET /api/v1/calendar` — multi-source timeline
- `GET /api/v1/sync` — connector status
- `POST /api/v1/connect` — store per-source credentials (encrypted at rest)
- `GET /api/v1/keys` / `POST /api/v1/keys` — list metadata / mint a key
- `POST /api/v1/ingest/identify` / `POST /api/v1/ingest/event` — identify and track

## MCP

HTTP `POST /api/mcp`. stdio: `src/mcp/server.ts`. `tools/list` is open. `tools/call` follows REST auth.

- `get_overview`, `query_users`, `get_cohorts`, `get_wbr`, `get_calendar`
- stdio also: `install_sdk`, `configure_value_events` (write)

## CLI

`npx @anykpi/cli` (`packages/cli`): `login` (alias `key`), `workspaces`, `connect`, `identify`, `track`, `overview`, `users`, `cohorts`, `wbr`, `calendar`, `sync`. `login` requires an operator key. `connect` stores source config only.

## Connectors

Shipped: PostHog, Mixpanel, Amplitude, Stripe. Pull-only (Stripe also accepts a signature-verified webhook at `POST /api/webhooks/stripe`). Connector setup is the `/connect` UI or `anykpi connect`. Config is encrypted at rest with `ANYKPI_SECRET`. Env vars are a deprecated read-only fallback.

## view_url

Read responses include a view_url that opens `/dashboard` in the workspace and view that prove the answer, e.g. `/dashboard?workspace=demo&view=dotplot`. Origin comes from `Host` / `X-Forwarded-*` unless `PUBLIC_BASE_URL` is set.

## Layout

- `src/app/api` — HTTP routes (REST, MCP, views, OpenAPI, `/llms.txt`)
- `src/core` — auth, Zod contracts, view-state, read-model loaders, `anykpi.config.json` loader (WBR exception thresholds beside the database)
- `src/mcp/server.ts` — stdio MCP server
- `src/connectors` — PostHog, Mixpanel, Amplitude, Stripe
- `src/demo` — canonical demo dataset
- `packages/cli` — CLI
- `docs/introduction.md` — human docs

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
- Validate inputs with Zod contracts in `src/core/contracts.ts`.
- TypeScript strict mode is on.
- Public copy: no internal briefs, no comparison to other products by name, no personal names.
