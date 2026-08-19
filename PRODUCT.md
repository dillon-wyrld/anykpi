# ANYKPI

**The growth stack for modern builders.**

Self-hosted dashboard + REST API + CLI + MCP. Connect your tools or add ANYKPI to your product. Same resources humans see in the dashboard, agents can fetch via API.

## Positioning: Midday's Product Shape

ANYKPI is **Midday's completeness** (app + API + CLI + MCP + docs + one-command install), **not Midday's features** (not banking, invoicing, time tracking).

**Like Midday:**
- Dashboard humans use
- REST API with real OpenAPI (same resources humans see)
- MCP + CLI (`npx @anykpi/cli`) — anything you do in the app, an agent can do
- Docs that read like a product, not a repo
- One step: connect (bank for Midday, analytics tools for ANYKPI)

**Different domain:**
- Midday: operational finance (bank, invoices, receipts, time)
- ANYKPI: founder metrics (users, retention, PMF signals, WBR)

## What It Is

1. **Connect data** (one step):
   - **Path 1**: Connect existing tools (PostHog, Mixpanel, Amplitude)
   - **Path 2**: Add ANYKPI to your product (SDK/snippet)
2. **Founder mode** — people, not averages
3. **Agent-native** — humans and agents see the same views
4. **Self-hosted** — person-level data never leaves your machine

Hosted waitlist (cloud + multiplayer) is extra, not the path.

## Demo is a workspace, not the product

A stranger who installs this never meets an empty screen. The default workspace is a seeded demo tenant on the **same schema, same views, same MCP** a live workspace uses.

When a connector authenticates, that workspace fills with their people. Views do not special-case demo. There is no “iOS users in France” chip, no canned query list, no fake agent parser. Those people exist only if they are in the data.

## Binding rules

- Calendar is read-only forever. No event editor, no manual entry.
- No self-narrating chrome. The answer is the view. No summary strips, no suggestion chips, no methodology quotes.
- Motion is one-shot and earned. No glows, no looping animation, no shadows on data marks.
- Demo data ships forever, as a workspace. It is also what CI runs against.
- Nothing sends on its own (PMF+ outreach).
- Person-level data never leaves the machine. No telemetry.
- The agent bar is tools over read models, plus a view-state URL. Not regex over demo phrases.

## Stack (approved)

- **App**: Next.js App Router + TS strict + Tailwind + shadcn
- **DB**: SQLite via Drizzle (Postgres via DATABASE_URL)
- **Charts**: Hand-rolled SVG ported from `spec/prototype.html`
- **API**: REST at `/api/v1` + OpenAPI from Zod contracts
- **MCP**: `/api/mcp` (same resources as REST)
- **CLI**: `npx @anykpi/cli` (login, workspace, connect, ingest, query)
- **Install**: One Docker container or `pnpm install && pnpm db:init && pnpm dev`
- **License**: MIT

**Specs:**
- Read models, connectors, MCP: `spec/architecture.md`
- UI/UX: `spec/prototype.html` (the prototype is the view spec)
- Product brief: `spec/brief.html`
- Platform docs: `docs/introduction.md`

## Complete Platform (Midday-Shaped)

Ship the full backbone:

### Dashboard (Humans)
- Five views: Dot Plot, Cohorts, WBR, Calendar, PMF+
- Workspaces: `demo` (default) and `live`
- Connect page: both paths (existing tools + SDK)
- View-state URLs (shareable proof)

### REST API (Any Client)
- `/api/v1/*` endpoints: overview, users, cohorts, wbr, calendar, sync
- OpenAPI spec from Zod contracts
- `/api-docs` page (Scalar viewer)
- Every response includes `view_url`

### CLI (Scripts + Agents)
- `npx @anykpi/cli` or `pnpm anykpi` locally
- Commands: login, workspace, connect, identify, track, overview, users, cohorts, wbr, calendar
- Structured JSON output (`--json` flag)
- Zero config files, agent-friendly

### MCP (Agents)
- `/api/mcp` with tools: get_overview, query_users, get_cohorts, get_wbr, get_calendar
- Same resources as REST API
- Every tool returns `view_url`

### Docs + Agents Page
- `docs/introduction.md` — who, what, connect, views, agents, API
- `/agents` page — MCP setup + CLI + REST examples
- README points at docs

### Install
- `pnpm install && pnpm db:init && pnpm dev`
- Docker: one command with persistent volume
- CI green (typecheck, unit tests, Playwright)
