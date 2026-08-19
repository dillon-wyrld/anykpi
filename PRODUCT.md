# ANYKPI

The growth dashboard a founder actually opens every morning — and the first one agents can read too.

This is a **production open-source product**, not a demo app. The bar is [Midday](https://github.com/midday-ai/midday), [T3 Code](https://t3.codes/), and [Pi](https://pi.dev/): a machine that runs on what you already have.

## What it is

1. Connect your tools and agents.
2. Founder mode — people, not averages.
3. Hosted waitlist if you want cloud, ANYKPI events, and multiplayer later.

You already pay for analytics, money, calendar, releases, and agents. ANYKPI syncs summaries into local read models and never writes back. Humans and agents look at the same views. Every agent answer carries the view that proves it.

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

Next.js App Router + TS strict + Tailwind + shadcn. SQLite via Drizzle (Postgres later). Hand-rolled SVG/canvas ported from `spec/prototype.html`. MCP at `/api/mcp`. One Docker container or `npx anykpi`. MIT.

Read models, connectors, and MCP: `spec/architecture.md`.
UI/UX spec: `spec/prototype.html` (the prototype is the view spec, not the app).
Product brief: `spec/brief.html`.

## First production cut

Ship the machine:

- One-command install
- Workspaces: `demo` (default) and `live`
- Connect front door: 
  - **Path 1**: PostHog, Mixpanel, or Amplitude connector (real sync)
  - **Path 2**: ANYKPI SDK (event ingestion, agent-installable snippet)
  - Agents: real MCP URL + key
- Five views reading only from read models
- View-state URLs that are the shareable answer
- Hosted waitlist link (extra, not the primary event path)
- Playwright against the demo workspace
