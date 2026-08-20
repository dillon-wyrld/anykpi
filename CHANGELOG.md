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
