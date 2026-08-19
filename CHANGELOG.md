# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Default-secure API keys: the API and MCP surface require a bearer key,
  verified in constant time; the `demo` workspace stays public-read while `live`
  and all writes require a key.
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
