# Recording connector HTTP fixtures

The harness in `src/connectors/testing/` replays committed request/response
pairs so connector tests never need the network. It is not tied to one
vendor — match on method + URL, return the recorded body.

## Capture a suite

1. Point the connector at a real project (env vars from `.env.example`).
2. Choose an output directory, usually
   `src/connectors/testing/fixtures/<source>/`.
3. Run the unit test with recording on:

   ```bash
   ANYKPI_RECORD_FIXTURES=1 pnpm test:unit src/connectors/index.test.ts
   ```

   `installConnectorFetch` writes `suite.json` into `recordDir` on restore.
   Authorization headers are never stored. Query params whose names look
   like secrets (`key`, `secret`, `token`, `auth`, `password`) are replaced
   with `REDACTED`.
4. Open `suite.json`. Trim to the smallest body that still exercises the
   connector. Prefer `urlIncludes` or `urlPattern` over a full URL so host
   and project id can change in tests.
5. Re-run the same test *without* the env var. It must pass offline.

## Adding a new connector

1. Implement `Connector` (`source`, `name`, `sync` → `SyncResult`).
2. Drop a `suite.json` under `fixtures/<source>/` (or build fixtures
   inline in the test).
3. In the test, `installConnectorFetch({ fixtures, recordDir, source })`,
   then call `connector.sync(...)`.
4. Assert `rowsSynced`, `nextCursor`, and `health`. Unexpected URLs throw
   — the harness does not fall through to the network.

See `harness.test.ts` for a source that is not PostHog, Mixpanel, or
Amplitude.
