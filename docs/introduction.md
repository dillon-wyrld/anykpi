# ANYKPI - The Growth Stack for Modern Builders

**Self-hosted dashboard + REST API + CLI + MCP**. Connect your tools or add ANYKPI to your product. Same resources humans see in the dashboard, agents can fetch via API.

## Who It's For

Founders who need:
- **People, not averages** — Every user gets a row, not a segment
- **Trust** — Numbers name their source and age
- **Agent-native** — Humans and agents see the same views
- **Self-hosted** — Person-level data stays on your machine unless you approve a PMF+ research query

## The One Step: Connect Data

Two paths, both agent-installable:

### Path 1: Connect Existing Tools
Shipped: PostHog, Mixpanel, Amplitude, Stripe, RevenueCat, Mercury, ICS. Roadmap: GitHub — tools you already pay for. ANYKPI syncs summaries into local read models and never writes back. Calendar ICS is read-only forever.

```bash
# Via UI
Visit /connect and enter credentials

# Via CLI ingest (same read models the connectors write)
anykpi identify user123 --name="Jane Doe"
anykpi track user123 song_played
```

Destinations can also push signed events to `POST /api/ingest/webhook/:source` — see [webhook recipes](webhooks.md).

### Path 2: Add ANYKPI to Your Product
Don't have PostHog/Mixpanel/Amplitude? Add the ANYKPI SDK. Events land in the same read models the connectors write.

```html
<script src="http://localhost:3000/sdk.js"></script>
<script>
  anykpi.init({ endpoint: 'http://localhost:3000', workspaceId: 'live' });
  anykpi.identify({ userId: 'user123', properties: { name: 'Jane' } });
  anykpi.track('song_played', { genre: 'jazz' });
</script>
```

## Five Views

1. **Dot Plot** — Every user, every day. Streaks and silences read instantly.
2. **Cohorts** — Retention curves with smile detection (PMF signal).
3. **Weekly Business Review** — 6 weeks, 12 months YOY, exceptions auto-surfaced. Thresholds live in `anykpi.config.json` beside the database; see [WBR exception rules](#wbr-exception-rules).
4. **Calendar** — Read-only timeline from connected sources.
5. **PMF+** — Research one person from a public source after you approve the outgoing fields (listed verbatim). Outreach drafts stay queued — nothing auto-sends.

Every view has a shareable URL.

## For Agents

### REST API

```bash
# Demo workspace is public-read. Live data needs a key or a browser session.
# Writes always need a key. Humans: POST /api/session once (cookie, not a URL).
curl http://localhost:3000/api/v1/overview?workspace=demo

curl http://localhost:3000/api/v1/overview?workspace=live \
  -H "Authorization: Bearer $ANYKPI_API_KEY"
```

Returns:
```json
{
  "workspace": "demo",
  "totalUsers": 627,
  "activeToday": 42,
  "weeklyActive": 156,
  "retentionRate": 25,
  "smileDetected": false,
  "exceptionsCount": 3,
  "upcomingEvents": 12,
  "view_url": "http://localhost:3000/dashboard?workspace=demo&view=dotplot"
}
```

**All endpoints:**
- `GET /api/v1/overview` — Company snapshot
- `GET /api/v1/users` — Query users (filter by cluster, platform, dates)
- `GET /api/v1/cohorts` — Retention with PMF signal; optional split by platform, country, or cluster (max 3 series)
- `GET /api/v1/wbr` — Weekly Business Review metrics
- `GET /api/v1/calendar` — Multi-source events
- `GET /api/v1/sync` — Connector status
- `GET /api/v1/freshness` — Last ingest + per-source last-sync stamps
- `POST /api/v1/sync` — Trigger a sync (one source or all; requires an API key)
- `POST /api/v1/import` — Import users or events from CSV (requires an API key)
- `GET /api/v1/keys` — List key metadata (scope, last used, legacy)
- `POST /api/v1/keys` — Generate API key (defaults to read)
- `POST /api/v1/keys/downgrade` — Convert legacy write keys to read
- `POST /api/session` — Start a browser session (signed httpOnly cookie; live views; key never in the URL)
- `DELETE /api/session` — Log out (clear the cookie)
- `POST /api/ingest/identify` — Identify user
- `POST /api/ingest/event` — Track event
- `POST /api/ingest/batch` — Batch track (up to 1k events; idempotent on `externalId`)
- `POST /api/ingest/webhook/:source` — Realtime push (HMAC; [recipes](webhooks.md))

**API Docs:** http://localhost:3000/api-docs (OpenAPI spec from Zod contracts)

### CLI

```bash
# Install
npx @anykpi/cli login
anykpi keys
anykpi keys downgrade

# Query
anykpi overview
anykpi users --cluster='🔥 Power daily'
anykpi cohorts --json
anykpi wbr --section=Finance
anykpi calendar --source=stripe
anykpi connect stripe --api-key rk_... --secret-key whsec_...
anykpi sync --source=stripe
anykpi sync --source=posthog
anykpi connect csv --kind=events --map user_id=personId
anykpi import events.csv --kind=events

# Ingest
anykpi identify user123 --name="Jane Doe" --email="jane@example.com"
anykpi track user123 song_played
```

Every command returns `view_url` for proof.

### MCP

Machine Context Protocol server at `/api/mcp`:

**Tools:**
- `get_overview` → company snapshot
- `query_users` → filter/group users
- `get_cohorts` → retention with smile detection; optional split (max 3 series)
- `get_wbr` → Weekly Business Review
- `get_calendar` → multi-source timeline
- `install_sdk` → generate SDK snippet
- `configure_value_events` → map events to activity classes

Every response includes `view_url`.

**Setup:**
```json
{
  "mcpServers": {
    "anykpi": {
      "command": "npx",
      "args": ["@anykpi/cli", "mcp"],
      "env": {
        "ANYKPI_API_URL": "http://localhost:3000",
        "ANYKPI_API_KEY": "ak_..."
      }
    }
  }
}
```

## Install

```bash
git clone https://github.com/dillon-wyrld/anykpi.git
cd anykpi
pnpm install
pnpm db:init      # Creates DB, seeds demo
pnpm dev          # http://localhost:3000
```

**Demo workspace** loads automatically with canonical dataset:
- 627 users across 24 cohorts
- 21 WBR metrics with real YOY
- 133 calendar events from 6 sources

**One Docker command:**
```bash
docker run -p 3000:3000 -v anykpi-data:/data ghcr.io/dillon-wyrld/anykpi
```

## Stack

- Next.js 15, TypeScript strict, Tailwind
- SQLite via Drizzle (`DATABASE_PATH`). [Postgres later](#postgres-later).
- Hand-rolled SVG charts from prototype learnings
- Zod contracts shared by UI, REST, MCP
- MCP SDK for agents
- Vitest + Playwright
- MIT License

## Philosophy

**Tagline:** The growth stack for modern builders

**Binding Rules:**
- Calendar read-only forever (no event editor)
- No self-narrating chrome (answer IS the view)
- One-shot motion (no glows, no loops)
- Demo ships forever as a workspace
- Nothing sends on its own (PMF+ drafts wait)
- No telemetry. Person-level data stays on the machine unless the founder approves a PMF+ research query — the disclosure lists every outgoing field before anything is sent.

## WBR exception rules

Thresholds live in `anykpi.config.json` beside the SQLite file (the same directory as `DATABASE_PATH`). There is no settings UI — copy `anykpi.config.example.json` next to the database and edit it. The file is Zod-validated at boot; an invalid value fails startup and prints the offending path (for example `wbr.exceptions.consecutiveMissesForOff`). Missing file uses the defaults below.

| Key | Default | What it means |
|---|---|---|
| `wbr.exceptions.consecutiveMissesForOff` | `2` | Consecutive weeks off target before a metric is **off** |
| `wbr.exceptions.consecutiveMissesForWatch` | `1` | Consecutive weeks off target before a metric is **watch** (must be ≤ off) |
| `wbr.exceptions.inputThinWinStdDevs` | `1` | Inputs on the right side of target by less than this × weekly standard deviation stay **watch** |
| `wbr.exceptions.wrongWayLookbackWeeks` | `3` | Inputs still on target but turning the wrong way across this many weeks are **watch** |

Every exception row states, in plain words, the rule that fired (`Rule: 2 or more consecutive weeks off target.`).

## Postgres later

Storage is SQLite, configured with `DATABASE_PATH` (see `.env.example`).
Postgres is planned for a later hosted deployment and is not wired up.
There is no `DATABASE_URL` and no Postgres driver in this tree.

## API Reference

Full OpenAPI spec: http://localhost:3000/api-docs

## Community

- **GitHub:** https://github.com/dillon-wyrld/anykpi
- **Issues:** https://github.com/dillon-wyrld/anykpi/issues
- **License:** MIT

---

**Vision:** Unified insights for modern day builders
