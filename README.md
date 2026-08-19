# ANYKPI

**The growth stack for modern builders.**

Self-hosted dashboard + REST API + CLI + MCP. Connect your tools or add ANYKPI to your product. Same resources humans see in the dashboard, agents can fetch via API.

Founder metrics: users, retention, PMF signals, WBR.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Next.js](https://img.shields.io/badge/Next.js-15-black)

## What It Is

ANYKPI is an open-source dashboard. The only step is connecting data.

### Two On-Ramps (both agent-installable)

**Path 1: Connect existing tools**  
Shipped: PostHog, Mixpanel, Amplitude (`src/connectors/`). Roadmap: Stripe, calendar/ICS, GitHub — tools you already pay for. ANYKPI syncs summaries into local read models and never writes back. An agent can do this unattended.

**Path 2: Add ANYKPI events to your product**  
Don't have PostHog/Mixpanel/Amplitude? Add the ANYKPI SDK. Same step, human or agent. Events land in the same read models the connectors write. Self-hosted, person-level data never leaves your machine.

Both paths are first-class.

## Five Views

1. **Dot Plot** — Every user, every day. Streaks and silences read instantly.
2. **Cohorts** — Retention curves with smile detection (PMF signal).
3. **Weekly Business Review** — 6 weeks, 12 months, exceptions auto-surfaced.
4. **Calendar** — Read-only. Synced from connected tools.
5. **PMF+** — Research users, draft outreach (queued, never auto-sent).

Every view has a shareable URL.

## Install

```bash
git clone https://github.com/dillon-wyrld/anykpi.git
cd anykpi
pnpm install
pnpm db:init
pnpm dev
```

The demo workspace loads automatically (public-read, fictional people). Set `ANYKPI_API_KEY` before connecting live data or deploying.

Start with the [self-host quickstart](#install).

Hosted version: join the [waitlist](https://github.com/dillon-wyrld/anykpi/discussions).

## Platform

- **Dashboard** at `/dashboard` — Five views with shareable URLs
- **REST API** at `/api/v1/*` — [OpenAPI reference](docs/introduction.md#rest-api)
- **CLI** via `npx @anykpi/cli` — [Install guide](docs/introduction.md#cli)
- **MCP** at `/api/mcp` — [Agent setup](docs/introduction.md#mcp)
- **Docs** at [docs/introduction.md](docs/introduction.md)

## Connect Data

Visit `/connect` or use CLI:

```bash
# Connect via CLI
anykpi connect posthog
anykpi connect mixpanel
anykpi connect amplitude

# Or add SDK to your product
# Visit /connect for snippet
```

[Full connect guide →](docs/introduction.md#the-one-step-connect-data)

## Agent Setup

ANYKPI is agent-native from day zero. Give your AI agent access via MCP:

1. Set `ANYKPI_API_KEY` and mint an additional key at `/connect` (or send the env key as `Authorization: Bearer`)
2. Add to your agent's MCP configuration:

```json
{
  "mcpServers": {
    "anykpi": {
      "url": "http://localhost:3000/api/mcp",
      "apiKey": "ak_..."
    }
  }
}
```

3. The agent can now:
   - Query users (`query_users platform=ios country=FR`)
   - Get cohorts (`get_cohorts`)
   - Check WBR metrics (`get_wbr`)
   - Get calendar events (`get_calendar`)

Every response includes a `view_url` that opens the dashboard in the state that proves the answer.

### Agent Can Install ANYKPI

Give your agent this prompt:

```
Install the ANYKPI SDK in my app. Configure "song_played" as the core value event. 
Verify first events arrive.
```

The agent can do this unattended via MCP tools.

## Stack

- **Next.js 15** — App Router, TypeScript strict mode
- **SQLite + Drizzle** — Fast local read models via `DATABASE_PATH` ([Postgres later](docs/introduction.md#postgres-later))
- **Tailwind + shadcn** — Linear-light aesthetic
- **Hand-rolled SVG charts** — Seven rounds of prototype learnings baked in
- **MCP** — Streamable HTTP at `/api/mcp`

## Production Deploy

### Docker

```bash
docker build -t anykpi .
docker run -p 3000:3000 \
  -e ANYKPI_API_KEY=your-secret \
  -v anykpi-data:/data \
  anykpi
```

`view_url` values use the request `Host` / `X-Forwarded-*` origin. Set `PUBLIC_BASE_URL` only if you need to pin them.

In production, if `ANYKPI_API_KEY` is unset, writes and non-demo reads are refused (503). Copy `.env.example` and see [SECURITY.md](SECURITY.md).

Data lives in the SQLite file at `DATABASE_PATH` (default `./data/anykpi.db`, or `/data/anykpi.db` in Docker). Back it up. It's yours.

## Design Principles (binding)

- **Calendar is read-only forever.** No event editor, no manual entry.
- **No self-narrating chrome.** The answer is the view. No summary strips, no suggestion chips.
- **Motion is one-shot and earned.** No glows, no looping animation, no shadows on data marks.
- **Demo data ships forever.** A stranger never meets an empty screen.
- **Nothing sends on its own.** PMF+ outreach waits for approval.
- **No telemetry.** Person-level data never leaves the machine.

## Why It Wins

- **People, not averages** — The flagship view is named humans on a grid
- **Agent-native from day zero** — Agents aren't bolted on; they're first-class
- **Your data stays yours** — Self-hosted, no telemetry, ever
- **It teaches the method** — Choose "opened the app" as your value event and it warns you that's vanity
- **Your agent sets it up** — You don't instrument by hand
- **It's genuinely fun** — Stickers, emoji, confetti, without costing legibility

## Roadmap

- [x] Core dashboard on demo data
- [x] PostHog, Mixpanel, Amplitude connectors
- [x] ANYKPI SDK for direct event ingestion
- [x] MCP server for agents
- [ ] Stripe, RevenueCat, Mercury connectors
- [ ] ICS calendar, GitHub releases
- [ ] Milestone detector (1000th signup, company birthday, streaks)
- [ ] Semantic user clustering
- [ ] PMF+ web research

## Contributing

MIT licensed. PRs welcome.

Self-hosted is free forever.

---

Built with ❤️ for founders who want to see their people.
