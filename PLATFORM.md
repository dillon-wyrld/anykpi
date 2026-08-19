# ANYKPI Platform - Complete

**The growth stack for modern builders.**

Midday's completeness (app + API + CLI + MCP + docs), founder metrics domain.

## What Shipped

### One Backbone

Dashboard, REST API, CLI, and MCP all expose the same resources. Zod contracts shared across all layers.

```
User sees in dashboard → Same resource in REST API → Same tool in MCP → Same command in CLI
```

### 1. Dashboard (Humans)

**Five Views:**
- **Dot Plot** — Every user, every day. Streaks visible.
- **Cohorts** — Retention curves with smile detection (PMF signal)
- **WBR** — 21 metrics, 5 sections, real YOY. Exceptions auto-surfaced.
- **Calendar** — Read-only timeline from 6 sources
- **PMF+** — Simulated research with to-send queue (nothing sends on its own)

**Features:**
- Workspaces: `demo` (canonical dataset) and `live`
- Connect page: PostHog/Mixpanel/Amplitude OR ANYKPI SDK
- View-state URLs (shareable proof)
- No self-narrating chrome

**Demo Workspace:**
- 627 users across 24 cohorts (seed 777)
- 36 NAMED users: Dave (🧢), Mia (🎧), Jo, Rex, Kai...
- 21 WBR metrics with 12 months YOY
- 133 calendar events from 6 sources
- Initech account: 3/10 activation (pinned fact)

### 2. REST API (Any Client)

**Endpoints:**
```
GET  /api/v1/overview              Company snapshot
GET  /api/v1/users                 Query users (filter by cluster, platform, dates)
GET  /api/v1/cohorts               Retention with PMF signal
GET  /api/v1/wbr                   Weekly Business Review metrics
GET  /api/v1/calendar              Multi-source events
GET  /api/v1/sync                  Connector status
POST /api/v1/keys                  Generate API keys
POST /api/v1/ingest/identify      Identify user
POST /api/v1/ingest/event         Track event
```

**OpenAPI:**
- Spec at `/api/openapi` (generated from Zod contracts)
- Interactive docs at `/api-docs` (Scalar viewer)

**Every response includes `view_url`:**
```json
{
  "totalUsers": 627,
  "smileDetected": false,
  "view_url": "http://localhost:3000/dashboard?workspace=demo&view=dotplot"
}
```

### 3. CLI (Scripts + Agents)

**Install:**
```bash
npx @anykpi/cli login
```

**Commands:**
```bash
# Query
anykpi overview
anykpi users --cluster='🔥 Power daily'
anykpi cohorts --json
anykpi wbr --section=Finance
anykpi calendar --source=stripe

# Ingest
anykpi identify user123 --name="Jane Doe" --email="jane@example.com"
anykpi track user123 song_played

# Connect
anykpi connect posthog
anykpi connect mixpanel
```

**Features:**
- Structured JSON output (`--json` flag)
- Colored terminal output for humans
- Zero config files
- Config stored in `~/.anykpi/config.json`
- Agent-friendly (every command can be scripted)

### 4. MCP (Agents)

**Endpoint:** `/api/mcp`

**Tools:**
- `get_overview` → company snapshot
- `query_users` → filter/group users
- `get_cohorts` → retention with smile detection
- `get_wbr` → Weekly Business Review metrics
- `get_calendar` → multi-source timeline

**Setup:** Visit `/agents` page for complete config

Every tool returns `view_url` for proof.

### 5. Docs + Agents Page

**Documentation:**
- `docs/introduction.md` — Platform guide (who, what, connect, views, agents, API)
- README points to docs
- `/api-docs` — Interactive OpenAPI viewer

**Agents Page (`/agents`):**
- Generate API key in-app
- MCP config with copy button
- CLI setup instructions
- REST API examples
- Agent-installable connect section

## Trust Layer

**Every number names its source and age:**
- Calendar: "from Stripe · synced 4m ago"
- WBR metrics: include source metadata
- Sync states: show last sync time and status

**Stats are pure functions:**
- `wbrStat()` — computes metric status (ok/watch/off)
- `detectSmile()` — PMF signal from retention curves
- Golden tests ensure stability
- PRNG guards prevent silent data shifts

## CI & Tests

**GitHub Actions:**
- Typecheck (TypeScript strict)
- Unit tests (Vitest)
- E2E tests (Playwright against demo workspace)

**Golden Tests:**
- Stats functions with known outputs
- PRNG stability (seed 777, 31337, 888)
- Cohort sizes match expected values
- Named users in correct cohorts

**E2E Tests:**
- Demo workspace never empty
- NAMED users present (Dave, Mia, Jo...)
- Initech account: 3/10 activation
- Smile detection works
- Calendar read-only (zero authoring controls)
- Navigation between views
- MCP endpoint accessible

## Install

```bash
# Clone and run
git clone https://github.com/dillon-wyrld/anykpi.git
cd anykpi
pnpm install
pnpm db:init      # Creates DB, pushes schema, seeds demo
pnpm dev          # http://localhost:3000

# Test
pnpm test:unit    # Stats golden tests
pnpm test:e2e     # Playwright E2E

# CLI
pnpm anykpi login
pnpm anykpi overview

# Build
pnpm build        # Next.js production build
```

**Docker:**
```bash
docker run -p 3000:3000 -v anykpi-data:/app/data anykpi/anykpi
```

## Stack

- **App**: Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui
- **DB**: SQLite via Drizzle (Postgres via DATABASE_URL)
- **Charts**: Hand-rolled SVG from prototype learnings
- **Contracts**: Zod schemas shared by UI, REST, MCP
- **API**: REST at `/api/v1`, OpenAPI from Zod
- **MCP**: `@modelcontextprotocol/sdk`
- **CLI**: Commander, Chalk, Ora (packages/cli)
- **Tests**: Vitest (unit), Playwright (E2E)
- **License**: MIT

## Binding Rules

✅ **Calendar read-only forever** — No event editor, no manual entry  
✅ **No self-narrating chrome** — Answer IS the view  
✅ **One-shot motion** — No glows, no loops  
✅ **Demo ships forever** — Never empty, same schema as live  
✅ **Nothing sends on its own** — PMF+ drafts wait in queue  
✅ **No telemetry** — Person-level data never leaves machine

## Architecture

**Read Models (SQLite):**
- users, activity, accounts, metricDefs, metricPoints, calEvents, syncState, apiKeys

**Connectors:**
- PostHog, Mixpanel, Amplitude (incremental sync)
- ANYKPI SDK (direct ingestion)

**API Layers:**
- `/api/views/*` — UI-specific responses
- `/api/v1/*` — REST API (OpenAPI)
- `/api/mcp` — Machine Context Protocol
- Packages/cli — Command-line interface

**View State:**
- All UI state serializes to URL
- Shareable links = shareable proof
- Every API/MCP response includes `view_url`

## Comparison: Midday Shape

| Feature | Midday | ANYKPI |
|---------|--------|---------|
| **Domain** | Operational finance | Founder metrics |
| **Dashboard** | ✓ Bank, invoices, time | ✓ Users, cohorts, WBR, calendar |
| **REST API** | ✓ `/api/v1/*` | ✓ `/api/v1/*` |
| **OpenAPI** | ✓ Scalar docs | ✓ `/api-docs` |
| **CLI** | ✓ `npx @midday-ai/cli` | ✓ `npx @anykpi/cli` |
| **MCP** | ✓ 80 tools | ✓ 5 tools (extensible) |
| **Docs** | ✓ Product-style | ✓ `docs/introduction.md` |
| **Install** | ✓ One command | ✓ `pnpm db:init && pnpm dev` |
| **Self-hosted** | ✓ | ✓ |
| **License** | Proprietary | MIT |

## What's Next

**Current State:** Complete platform shipped. Dashboard, API, CLI, MCP all working. Demo workspace with canonical data. CI green.

**Future Enhancements:**
- Advanced chart mechanics (streak strips, minimap, smile confetti)
- More connectors (Stripe, RevenueCat, Mercury, GitHub)
- Session replay integration
- Semantic clustering
- PMF+ web research (currently simulated)

**Not in scope for this cut:**
- Session replay connectors
- Advanced visualization treatments
- Hosted cloud version (waitlist only)

## Done When

✅ Stranger gets Midday-shaped install  
✅ Dashboard they can trust  
✅ Agent can fetch anything human sees  
✅ CI green  
✅ README honest  

**All done.**

---

**Positioning:** The growth stack for modern builders  
**Bar:** Midday-level completeness  
**Status:** Production ready  
**PR:** https://github.com/dillon-wyrld/anykpi/pull/1
