# Security

## API keys

Set `ANYKPI_API_KEY` in the environment before a production deploy:

```bash
export ANYKPI_API_KEY='your-secret'
```

Send it as `Authorization: Bearer <key>` or `x-api-key: <key>`.

- Ingest (`POST /api/ingest/event`, `POST /api/ingest/identify`), key minting (`POST /api/v1/keys`), MCP `tools/call` (except demo read-only tools), and all non-demo reads require a valid key.
- Webhook ingest (`POST /api/ingest/webhook/:source`) is authenticated by a per-source HMAC-SHA256 secret stored via `POST /api/v1/connect`. A bad or missing signature returns 401. Re-submitting the secret rotates it immediately.
- Presented keys are SHA-256 hashed and compared timing-safe against `api_keys.hashedKey`. Keys carry a scope: `read`, `write`, or `admin`. New keys default to read. `ANYKPI_API_KEY` is the operator/admin key (also valid) and may choose a workspace. A read key on a write returns 403. Other keys bind to their workspace. Last-used is recorded on each successful presentation.
- The `demo` workspace is public-read (seeded fictional people). Writes still require a key.
- In production (`NODE_ENV=production`), if `ANYKPI_API_KEY` is unset and no valid hashed key is presented, writes and non-demo reads return 503. The process will not run open.

Hashed keys in the `api_keys` table are accepted after you bootstrap with the env key (or a one-time local first key when the table is empty).

## Connector secrets

Set `ANYKPI_SECRET` to encrypt per-source config at rest (`sources.config`).
`POST /api/v1/connect` and `anykpi connect` persist ciphertext only. Sync
receives decrypted config in process and never returns credentials.
Environment variables for the shipped connectors remain a deprecated
read-only fallback.

## Telemetry

ANYKPI does not send telemetry. Person-level data stays on the machine that hosts the process.

## Reporting a vulnerability

Please report vulnerabilities via [GitHub Security Advisories](https://github.com/dillon-wyrld/anykpi/security/advisories).
