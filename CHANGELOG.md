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
- Fresh clones build and initialize again: auto-create the database directory
  and build `better-sqlite3` on install.
- The Docker image builds and initializes its schema on first boot.
- API status comparisons and types corrected (`ok` vs `on`); `tsc`/`build`/CI
  are green.
- Regenerated database migrations to match the current schema.

### Added
- Working ESLint configuration; CI now gates on lint, unit tests, and a build.
- Contributor docs (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`) and issue/PR
  templates.

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
