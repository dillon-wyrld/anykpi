# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Browser session for the live workspace (ANY-36): `POST /api/session` verifies
  the API key once and sets a signed `httpOnly` + `SameSite=Lax` cookie so
  dashboard views load without putting the key in a URL. Demo stays public-read.
  `DELETE /api/session` logs out. Writes stay key-only.
- Default-secure API keys: the API and MCP surface require a bearer key,
  verified in constant time; the `demo` workspace stays public-read while `live`
  and all writes require a key.
- Per-source connector config is stored in `sources` and encrypted at rest
  with `ANYKPI_SECRET`. Credentials never appear in API responses or logs.
- Added key revocation (`DELETE /api/v1/keys/:id`) and scoped key-metadata
  listing to the caller's workspace.
- Rate-limited and size-bounded the ingest endpoints.

### Fixed
- One shared day clock (ANY-53): MCP `get_overview` no longer computes
  Day N from a private `2024-01-01` instant. REST overview, MCP
  overview, and the calendar birthday all read `src/core/day.ts`,
  anchored to the workspace home timezone.
- E2E after the Postgres matrix (ANY-47): `anykpi export --json --out`
  prints a receipt instead of echoing the full dump (CLI smoke was
  dying with `exited null` / maxBuffer on the demo workspace). MCP
  HAPPY_PATH covers `queue_outreach` / `approve_outreach` /
  `send_outreach` and those tools return `viewUrl`. `@anykpi/sdk`
  flushes immediately when `flushIntervalMs` is 0 so the npm-install
  consumer does not hang on an unref'd timer.
- Sync-state and config upserts now target unique indexes
  (`sync_state (workspace_id, source)` and `config (key, workspace_id)`)
  so a second write updates the existing row instead of erroring or
  duplicating.
- Calendar no longer drops `workspace` / `view` query params on mount, so the
  view stays on Calendar instead of snapping back to Dot Plot.
- Fresh clones build and initialize again: auto-create the database directory
  and build `better-sqlite3` on install.
- The Docker image builds and initializes its schema on first boot.
- API status comparisons and types corrected (`ok` vs `on`); `tsc`/`build`/CI
  are green.
- Regenerated database migrations to match the current schema.
- `@anykpi/cli` `track` / `identify` now POST to `/api/ingest/*` (with
  `Authorization: Bearer` and `x-api-key` when a key is configured).

### Added
- ANYKPI wordmark and tab icon (ANY-51): dashboard nav and wall-mode
  masthead render the modular-tile mark at 19px with the quiet `beta`
  tag. Light and dark-ground 2×/3× assets live in `public/brand/`. The
  tab icon is the K-tile glyph.
- Shared day clock (ANY-53): day number, time left today, week number,
  and the next-milestone ladder (100, 200, … 365, 500, 730, 1000, then
  centuries), in `src/core/day.ts`. Home timezone is the existing
  config table (`home_timezone:<workspace>`); `company_name` / `home_city`
  stay for ANY-52.
- Company profile per workspace (ANY-52): `company_name` and `home_city`
  (IANA timezone + label) sit beside `founded_at` in the existing config
  table. `/connect` and `anykpi config` set all three. Demo seeds as
  YourCo in San Francisco. A founded date in the future is refused.
  Setting the name changes `Day of <name>`.
- User geography from real sources (ANY-57): `users.timezone` (IANA)
  plus country filled on PostHog sync, identify (device timezone from
  the snippet and SDK), and CSV import. Precedence is explicit
  property, then device timezone, then a country-derived fallback.
  Users with no signal stay off the city rows; the geography module
  counts them as unplaced. Migration `0010_user_timezone`.
- Postgres query-compat and CI matrix (ANY-47): view builders and
  read-model writers share one query shape on SQLite and Postgres.
  Timestamps stay Date objects, upserts use `excluded`, and writes that
  need a transaction run sync on SQLite and async on Postgres. Unit
  tests use a SQLite file or in-process PGlite (`ANYKPI_DB_ENGINE`);
  CI runs the full suite on both engines every push.
- Postgres scaffold via `DATABASE_URL` (ANY-33): sqlite-core remains the
  v0.x source of truth. A Postgres schema mirror, `drizzle/sqlite` +
  `drizzle/pg` journals, and a Docker entrypoint that selects by
  `DATABASE_URL` ship with a drift test that both schemas declare the
  same tables and columns. SQLite via `DATABASE_PATH` stays the
  zero-config default.
- Multi-workspace isolation and switcher (ANY-39): `users`, `accounts`,
  `metric_defs`, and `config` now use composite `(workspace_id, id)`
  primary keys so the same distinct_id can exist in two products.
  A `workspaces` catalog (`id`, `name`, `createdAt`, `archivedAt`)
  backfills from existing rows. The dashboard switcher lists that
  catalog and prompts for a key the first time you switch into a live
  workspace; the signed session holds one unlock per workspace, never
  the key. `GET`/`POST`/`PATCH /api/v1/workspaces`. Migration
  `0009_workspaces`.
- Person deletion that survives re-sync (ANY-38): `DELETE /api/v1/users/{id}`
  purges the person and their events, cascades through person-level read
  models, and writes a tombstone (`workspaceId` + external ids) consulted
  by connector upserts, CSV import, and batch ingest. Key-only — a
  browser-session DELETE is 403 so the audit row names the deleting
  actor. Migration `0008_tombstones`.
- Outreach outcome tracking (ANY-27): tag a draft `replied`,
  `interviewed`, or `converted` from the PMF+ queue or
  `anykpi outreach --id … --outcome`. Tags live in the existing
  `config` table (keyed by outreach id) so schema.ts stays untouched.
  The PMF+ view and `GET /api/v1/outreach` roll conversion by cluster.
- Outreach delivery with structural per-send approval (ANY-26): drafts
  persist in `outreach` (waiting / approved / sent). The only delivery
  function takes a persisted approval record and refuses anything else —
  including via MCP. Write-scoped keys can queue drafts but cannot
  approve them; approval is a browser session or an admin key. Every
  send is logged with timestamp, recipient, and the approving actor, and
  writes an audit row. Mail credentials (Resend or SMTP) are stored via
  ANY-46 (`POST /api/v1/connect` source `resend` or `smtp`).
- Connector health panel on `/connect` (ANY-19): per source, last sync,
  rows pulled, next scheduled run (`SYNC_INTERVAL_MINUTES`), a
  plain-language error with a next step, and Sync now. A failed source
  is rendered from `sync_state` / `syncHealth` — not a status code.
- MCP write tools (ANY-28): `connect_source`, `trigger_sync`, and
  `import_csv` so an agent can connect data unattended. Each requires a
  write-scoped key, returns a `view_url`, and records `mcp.call` on the
  audit log. HTTP `tools/list` advertises them.
- Scheduled refresh (ANY-17): `instrumentation.ts` starts an in-process
  pull every `SYNC_INTERVAL_MINUTES` (default 15). `0` disables for
  hosts that `POST /api/v1/sync` from cron (`docs/cron.md`). Runs share
  ANY-16's coalesce lock. A nightly full pass reconciles drift.
  Failures mark the source error; `GET /api/v1/overview` and
  `get_overview` expose `syncHealth`.
- Action audit log (ANY-30): every write (ingest, connect, import, keys,
  sync, MCP mutation) records actor (key id, `env`, or `session`), action,
  subject, and timestamp. Query `GET /api/v1/audit` (filter by actor and
  since/until). A thin readout lives on `/connect`.
- Full workspace export and a documented SQLite backup (ANY-37).
  `anykpi export` writes JSON or CSV of users, events, and read models
  (`GET /api/v1/export`). Users and events reload through ANY-12 import.
  Connector-backed read models restore by re-syncing the source — stated
  in `docs/backup.md`, not expected of import. SQLite snapshot uses
  `sqlite3 .backup` so WAL pages are included.
- Playwright coverage for the `/connect` mint flow and live workspace
  auth gate (ANY-43). Demo stays public-read; live views load only after
  a minted key starts a browser session.
- GitHub connector (ANY-11): token-based read of releases, stars, and
  commit cadence. Releases land as calendar events; star count and
  weekly commits land as WBR context. Token is stored via `/connect`
  or `anykpi connect github`. Offline fixture tests only.
- `POST /api/ingest/batch` accepts up to 1k events in one transaction
  (ANY-32). Duplicates no-op on ANY-12's `(workspaceId, externalId)`.
  The SDK buffers `track()` and flushes through the batch path with a
  stable idempotency key so a retry does not double-count.
- API key scopes (`read` / `write` / `admin`) and last-used tracking
  (ANY-29). New keys default to read. The env `ANYKPI_API_KEY` is admin.
  Existing keys migrate to write and show as `legacy` until
  `anykpi keys downgrade`. A read key on a write returns 403 with a
  plain-language error. `configure_value_events` requires write scope.
- Incremental connector sync (ANY-18): PostHog, Mixpanel, and Amplitude
  paginate to completion, persist a per-source cursor in the ANY-44
  sync_state slot, and dedup on `(workspaceId, externalId)` so a re-run
  fetches and writes nothing when the source is unchanged.
- Mercury connector (ANY-15): read-only account balances and trailing
  posted transactions into `balance_snapshots`. Monthly burn and runway
  months are computed from the last 90 days; the token is stored via
  ANY-46. Offline fixture tests only.
- ICS calendar connector: paste a feed URL (stored via the ANY-46)
  sources table), poll on `POST /api/v1/sync`, and fill the read-only
  Calendar view / `get_calendar`. Recurring expansion stays on the local
  wall clock across DST (ANY-10). No schema migration.
- Dashboard views poll `GET /api/v1/freshness` (~30s, paused when the
  tab is hidden) and refetch in place when last-ingest or a source
  last-sync stamp moves. No spinner on refresh (ANY-49).
- RevenueCat connector (ANY-14): paginated customer / subscription
  backfill into the same revenue read models as Stripe (trials,
  conversions, and churn). Secret key is stored via `/connect` or
  `anykpi connect revenuecat`. Offline fixture tests only.
- `POST /api/ingest/webhook/:source` accepts signed destination payloads
  (HMAC-SHA256). The per-source secret is stored via ANY-46 and rotates
  on re-submit. Recipes: `docs/webhooks.md` (ANY-13).
- PMF+ web research (ANY-25): enrich one selected person from a public
  source, only after the founder approves the outgoing fields listed
  verbatim. Loading the view never calls fetch. Results cache locally in
  `research-cache.json` beside the database — no schema change.
- Stripe connector (ANY-09): paginated subscription backfill into the
  revenue read models, plus `POST /api/webhooks/stripe` for
  signature-verified live MRR updates. Restricted key is stored via
  `/connect` or `anykpi connect stripe`. Scheduled sync is the
  reconciliation pass.
- Configurable WBR exception rules in `anykpi.config.json` beside the
  database (ANY-24). Defaults are documented in `anykpi.config.example.json`
  and `docs/introduction.md`. Invalid config fails at boot and prints the
  offending path. Every exception row names the rule that fired.
- `POST /api/v1/connect` and `anykpi connect` store per-source credentials
  encrypted at rest. The registry decrypts config for `Connector.sync`.
  Env vars stay a deprecated read-only fallback (ANY-46).
- Person drill-down on the dot plot: click a name or a dot to open a
  keyboard-reachable panel (Escape closes) with the event timeline,
  first/last seen, cohort, cluster, platform, and the summarized revenue
  block. `?user=` restores the panel; MCP `query_users` rows include a
  per-user `view_url`.
- `POST /api/v1/sync` triggers one registered source or all, with
  `pending → success/error` state transitions and in-process coalescing of
  concurrent runs for the same source. CLI: `anykpi sync`.
- Working ESLint configuration; CI now gates on lint, unit tests, and a build.
- Contributor docs (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`) and issue/PR
  templates.
- Shared `Connector` interface and source-keyed registry (`sync("posthog")`)
  with cursor + health `SyncResult`, plus an offline recorded-fixture harness
  for connector tests (ANY-44).
- Offline contract tests for PostHog, Mixpanel, and Amplitude against recorded
  fixtures, including 401 and rate-limit paths (ANY-41).
- Tagged `v*` releases build and pack `@anykpi/cli`. Publish runs only when
  the `NPM_TOKEN` secret is present; otherwise the workflow logs a skip.
- Tagged `v*` releases also push `linux/amd64` and `linux/arm64` images to
  `ghcr.io/dillon-wyrld/anykpi` (`latest` plus the version tag).
- CLI smoke coverage: every published `--help` command against a local
  instance, and `track` is visible via `/api/v1/users`.
- `@anykpi/sdk` package with ESM, CJS, and browser IIFE builds. The
  `/connect` snippet loads the locally built `/sdk.js` artifact. Types
  ship with the package. Public npm publish of `@anykpi/sdk` is a
  follow-up after the CLI release workflow lands its next change.
- Unit-test net for every on-screen view number (ANY-40): DotPlot-derived
  fields, cohort retention/smile/grade, WBR exception engine / YoY / PoP,
  calendar past/future, and PMF card fields. View math lives in
  `src/core/views/*` as pure functions.
- README hero screenshot and five-view demo GIF, recaptured from the seeded
  `demo` workspace with `pnpm readme:assets` (ANY-08).
- `docker-compose.yml` pulls `ghcr.io/dillon-wyrld/anykpi` into a named
  volume, plus a Railway one-click template that stays awake
  (`sleepApplication = false`, volume at `/data`) (ANY-35).
- Revenue read models (ANY-45): MRR snapshots, subscription events, the
  per-person revenue join, and balance/runway. Demo seed fills them;
  WBR shows those lanes with week-over-week deltas; cohorts and
  `get_cohorts` can filter to payers. Person charge detail stays summarized.
- Milestone detector (ANY-21): Nth signup (100 / 1,000 / 10,000), a new
  longest streak, company birthday, and first cohort smile. Detection is
  idempotent on `(workspaceId, kind, subject)` and lands as one-shot
  calendar rows. Demo seed includes at least one.
- Cohort compare mode (ANY-23): side-by-side retention curves split by
  platform, country, or cluster. State lives in the URL (`split`,
  `series`). `GET /api/v1/cohorts` and `get_cohorts` accept the same
  split. A fourth series is refused.

### Changed
- Removed internal design notes and competitor/brand references from the public
  repository.
- `view_url` now uses the request origin (`Host` / `X-Forwarded-*`).
  `PUBLIC_BASE_URL` is the only override. `NEXT_PUBLIC_BASE_URL` and
  `NEXT_PUBLIC_API_URL` are no longer read (they are inlined at build time
  and cannot configure a pulled Docker image).
- `/api/v1/users` returns a real `total` (separate COUNT) plus `hasMore` /
  `nextOffset` instead of the page length.
- README lists shipped connectors (PostHog, Mixpanel, Amplitude) separately
  from roadmap tools, and describes SQLite via `DATABASE_PATH`.
- GitHub language statistics exclude `spec/**` so TypeScript dominates the bar.
- Hosted-version copy points at the self-host quickstart and the GitHub
  Discussions waitlist instead of anykpi.com.
- Removed the stub `connect` command from the published CLI. Connector
  setup stays on `/connect` until connect ships for real.
