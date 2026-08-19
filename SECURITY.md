# Security

## API keys

Set `ANYKPI_API_KEY` in the environment before a production deploy:

```bash
export ANYKPI_API_KEY='your-secret'
```

Send it as `Authorization: Bearer <key>` or `x-api-key: <key>`.

- Ingest (`POST /api/ingest/event`, `POST /api/ingest/identify`), key minting (`POST /api/v1/keys`), MCP `tools/call` (except demo read-only tools), and all non-demo reads require a valid key.
- The `demo` workspace is public-read (seeded fictional people). Writes still require a key.
- In production (`NODE_ENV=production`), if `ANYKPI_API_KEY` is unset, writes and non-demo reads return 503. The process will not run open.

Hashed keys in the `apiKeys` table are accepted after you bootstrap with the env key.

## Telemetry

ANYKPI does not send telemetry. Person-level data stays on the machine that hosts the process.

## Reporting a vulnerability

Please report vulnerabilities via [GitHub Security Advisories](https://github.com/dillon-wyrld/anykpi/security/advisories).
