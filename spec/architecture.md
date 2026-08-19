# ANYKPI — Production Architecture Design

**Date:** 2026-08-07 · **Status:** Draft for Dillon's review · **Prototype spec:** `playgrounds/anykpi.html` · **Project truth:** `claude/context.md`

## 1. Goal

Turn the ANYKPI prototype into a production-grade project — independent of open-sourcing timing or a hosted cloud version. The prototype (one HTML file, deterministic fake data) is the UI/UX spec; this doc is the system that puts real data behind it.

Dillon's stated direction, taken as the starting position:
- PostHog is the source of truth for product events/logs (via its [product analytics API](https://posthog.com/docs/product-analytics/surfaces/api)).
- Everything else syncs directly from the owning APIs (Stripe, RevenueCat, Plaid/Mercury, Google Calendar, GitHub).
- The dashboard is the human front-end; agents call the same thing via an ANYKPI API/MCP.

This design confirms that direction and pins down the one place it needs correcting (live-proxy vs. sync), plus the concrete stack, data model, and build order.

## 2. The core decision: read models, not a live proxy

**Verified 2026-08-07 from PostHog's API docs:** private endpoints are rate-limited **per team, not per key** — analytics endpoints at 240/min · 1,200/hr, the query endpoint at 2,400/hr — and PostHog explicitly says that for "data-powered APIs or user-facing dashboards" you should not sit on the query API (they point you at batch exports or their paid "endpoints" product).

So ANYKPI must **not** render by querying PostHog live. Instead:

> **PostHog owns raw events. ANYKPI owns derived read models.** Scheduled sync jobs run a small number of aggregate HogQL queries (one query returns an entire user×day activity matrix) and store the *results* locally. The UI, REST API, and MCP all read from the local store — fast, offline-capable, rate-limit-friendly. Staleness is surfaced honestly with the "synced Nm ago" chips the prototype already designed.

The same pattern applies to every connector: sync → normalize → read model → render. The calendar's fix-round-6 decision ("a lens, not a system of record; read-only forever") already *is* this architecture; this generalizes it to all four surfaces.

## 3. Approaches considered

**A. Stateless live proxy (BFF).** Every render queries PostHog/Stripe/etc. directly. ✅ No sync infra, always fresh. ❌ Killed by team-wide rate limits, multi-second query latency on an interactive UI, no demo/offline mode, N sources × every page load. Rejected.

**B. Sync into local read models (RECOMMENDED).** Background jobs pull aggregates on schedules (+ webhooks where offered), store compact derived tables, everything reads locally. ✅ Fast UI, one canonical data shape shared by UI/API/MCP, demo mode is just a different filler for the same tables, respects rate limits, staleness is visible and honest. ❌ Sync code to build and operate — but the connector surface is small and the prototype's data shapes already define the target schema.

**C. Own event pipeline / warehouse (ClickHouse/DuckDB + batch exports + modeling layer).** ✅ Unlimited analytical power. ❌ Rebuilds what PostHog already does, heavy ops for a self-hosted OSS tool. Rejected for v1; note that PostHog **batch exports** are the documented escape hatch if a deployment ever outgrows query-based sync.

## 4. System overview

```
                    ┌────────────────────────────────────────────┐
                    │              ANYKPI (one app)              │
  PostHog ──sync──▶ │  connectors/   core/          surfaces/    │
  Stripe ──sync/──▶ │  posthog       read models    Next.js UI   │
          webhook   │  stripe        (SQLite)       REST /api/v1 │ ◀── humans
  RevenueCat ─sync▶ │  revenuecat    stats fns      MCP /api/mcp │ ◀── agents
  Mercury ──sync──▶ │  mercury       view-state     webhooks     │
  ICS feeds ─poll─▶ │  ics           URL codec      sync sched   │
  GitHub ──sync───▶ │  github        milestone det.              │
                    └────────────────────────────────────────────┘
```

One deployable unit: a single Next.js app in one Docker container (SQLite file inside a mounted volume). `docker run -v anykpi-data:/data anykpi` or `npx anykpi` for local dev. No Redis, no separate worker, no queue — at this scale an in-process scheduler is enough, and that's a feature for the "non-technical founder can run it" bar.

## 5. Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Next.js App Router + TypeScript strict + Tailwind + shadcn/ui** | House golden path; Linear-light aesthetic maps cleanly to shadcn primitives; one process serves UI + API + MCP. |
| DB | **SQLite via Drizzle ORM** (`DATABASE_URL` escape hatch to Postgres later) | Read models are small (2,000 users × 365 days ≈ 730k rows worst case — trivial). Zero-config for self-hosters; Postgres path preserved for a future hosted version. |
| Charts | **Hand-rolled SVG components, ported from the prototype** | The prototype encodes seven rounds of chart learnings (framed-not-zero-based 6-12 panes, label staggering, no-glow rule). A chart library would fight all of it. |
| Minimap | Canvas component (port of the 2-D minimap) | Same reason; DOM can't do 200×168 cells. |
| Background sync | In-process scheduler started from `instrumentation.ts` + webhook route handlers + a "Sync now" button | Single-process self-hosted deployment. (A Vercel-hosted variant would use cron routes — documented, not built.) |
| MCP | `@modelcontextprotocol/sdk`, streamable HTTP at `/api/mcp` (stdio bin later if demanded) | Agents connect with one URL + API key. |
| Validation/contracts | **Zod schemas shared by UI, REST, and MCP** | One contract, three consumers; OpenAPI generated from the same schemas. |
| Tests | Vitest (pure stats fns) + Playwright (promises suite) | See §12. |
| Repo | Fresh git repo (not the playgrounds dir), MIT license, GitHub Actions CI running `scripts/checks.sh` | Playgrounds stay as the design-history museum. |

Structure: single app, hard internal module boundaries — `src/core` (read models, stats, view-state codec), `src/connectors/*`, `src/mcp`, `src/demo`, `src/app` (routes/UI). Split into a monorepo only when something external (a published SDK) forces it. YAGNI.

## 6. Read models (the data layer)

These tables are the product's spine — every surface, API response, and MCP tool reads them. They are deliberately shaped like what the prototype already renders.

- **`users`** — person_id (PostHog person UUID), name, email, avatar, emoji, platform, country, income band, traits JSON, signup_date, cluster, account_id/seat info. Sourced from PostHog persons + properties.
- **`activity`** — (person_id, date, counts per event class: core/search/share/pay, minutes). *The dot-plot matrix.* One row per user-day with any activity. This single table also feeds cohorts.
- **`accounts` / `seats`** — B2B entities: account, entity, seat→person mapping, activation state, renewal date. From PostHog group analytics **or** an `account_id` person property (fallback matters: group analytics is a paid PostHog add-on).
- **`metric_defs`** — WBR metric definitions: name, section, input|output, good direction, unit/decimals, target, source spec (see §9). Deck order = array order = causal model, per the prototype.
- **`metric_points`** — (metric_id, grain week|month, period, value) including prior-year periods. WOW/YOY are *computed*, never stored.
- **`cal_events`** — (source, type, date, title, amount, badge, url, external_id). Read-only forever; no authoring paths exist anywhere.
- **`annotations`** — the one ANYKPI-*owned* write surface: stickers, highlights, notes pinned to a user/date/metric/cohort. This is the collaborative pattern-reading layer from the Lieb video.
- **`sync_state`** — (connector, last_synced_at, status, error, stats). Feeds the "synced 4m ago" chips.
- **`api_keys`** — hashed keys for REST/MCP auth.
- **`config`** — value-event mapping, company profile (name, founded date), connector settings (secrets encrypted, see §11).

Cohort tables are **derived at read time** from `activity` + `users.signup_date` (weekly buckets), so the smile detector (`coSlope`, `coFloorOf`, `coGrade`) ports as pure functions over one source of truth — no separate retention sync to drift.

## 7. Connector framework

Every connector implements one interface:

```ts
interface Connector {
  id: string;                      // "posthog" | "stripe" | ...
  auth: AuthSpec;                  // api_key | oauth | ics_url
  sync(since: Date): Promise<SyncResult>;  // incremental; writes read models
  webhook?: (req) => Promise<void>;        // optional push path
  status(): SyncState;
}
```

**PostHog (the special one — it's the query engine, not just a source).**
- Activity matrix: one HogQL query per sync — `select person_id, toDate(timestamp), <class counts> from events where event in (...) group by ...` over the configured window. Hourly incremental (re-query trailing 3 days to catch late events) + nightly full-window refresh. Budget: a handful of queries/hour against a 2,400/hr team-wide cap — polite by construction.
- Persons: daily sync of properties for enrichment.
- Never called at render time.

**Stripe.** Restricted read-only key. Webhooks (payouts, invoices, failed payments) for calendar freshness + 15-min poll for MRR/finance metric series. Cleanest WBR finance source.

**RevenueCat.** REST API v2, secret key. Trials, conversions, renewals → calendar + metrics.

**Banking: Mercury first, Plaid later.** ⚠️ Correction to the original plan: Plaid is a poor fit for self-hosted OSS — every self-hoster would need their own approved Plaid developer account and Link flow (high friction, paid B2B product). Mercury has a simple personal API token and covers the actual use case (payroll dates, runway checkpoints). Plaid becomes a later connector for multi-bank coverage, likely only ever relevant to a hosted version.

**Calendar: ICS first, Google OAuth later.** ⚠️ Second correction: Google Calendar OAuth requires each self-hoster to create an OAuth client — real friction. Since the calendar is **read-only forever**, a private ICS URL gives exactly read-only access with zero OAuth, works for Google/Outlook/Apple alike, and is a 15-minute poll. Google OAuth is a later upgrade for richer metadata.

**GitHub.** Token, releases/tags → calendar ship days.

**ANYKPI itself (milestone detector).** A local job that watches the read models and emits calendar events: 1,000th signup, 100th active day, company birthday, streak records. Pure function over local data; the most "us" connector.

## 8. The value-event config (THE config step)

Per Lieb, choosing the value event is the single most important configuration. Config holds an ordered mapping of event classes → PostHog events:

```yaml
value_events:
  core:   { events: ["song_played"],      label: "listened" }   # the dot
  search: { events: ["search_performed"] }                       # corner mark 🔍
  share:  { events: ["playlist_shared"] }                        # corner mark ↗
  pay:    { events: ["checkout_completed"] }                     # corner mark 💸
```

The four classes map 1:1 onto the prototype's cell grammar (dot / quadrant / stacked-bar segments / corner marks) — the cell design panel is already built to render exactly this. The setup wizard lists the project's top events from PostHog and **hard-warns on vanity events** (`$pageview`, `app_opened`, `session_start`, `login`) — the teaching moment from the playgrounds, enforced at setup.

## 9. WBR engine

Adopt wbr-app's proven config grammar (it's Apache-2.0 and battle-tested): metrics are `basic | filtered | derived`, each with a source spec —

- `posthog:` a HogQL template evaluated during sync into `metric_points`
- `stripe:` a named series (MRR, margin components)
- `manual:` CSV/inline for targets and things no API has (headcount, NPS)

WOW/MOM/YOY auto-computed for every metric (true WBR YOY: this week vs. same week last year — the prototype's fix-round-4 lesson). `wbrStat()` ports as-is: `off` = 2+ consecutive target misses; `watch` = fresh single miss or input noisier than its win; only inputs earn `watch`. Deck/Focus/Table views port from the prototype unchanged.

## 10. Agent surface (API + MCP)

**Design principle (binding, from fix round 5): the agent's answer IS the view.** Every piece of UI state — section, filters, grouping, zoom, minimap window, cell design — serializes into the URL via one view-state codec in `src/core`. Consequences: shareable links, Playwright-testable states, and every MCP/REST response can carry a `view_url` that opens the dashboard in exactly the state that answers the question.

**REST** `/api/v1/*` — API-key auth, same handlers as the UI's data needs, OpenAPI from the shared Zod schemas.

**MCP** at `/api/mcp` (streamable HTTP, same API keys). v1 tools:

| Tool | Returns |
|---|---|
| `get_overview` | company snapshot: day-N, headline metrics, exception count, sync health |
| `query_users` | filtered/grouped user list (`platform=ios country=FR` → the canon 5) + `view_url` |
| `get_activity` | the user×day matrix slice for users/range |
| `get_cohorts` | cohort table + smile flags + PMF verdict + `view_url` |
| `get_wbr` | deck with computed statuses and the exception sentences + `view_url` |
| `get_calendar` | events in range by source + `view_url` |
| `annotate` | the one write: pin a sticker/note (the collaborative layer) |
| `get_sync_status` | connector freshness/errors |

**Positioning vs. PostHog's own MCP** (they ship trends/funnels/SQL tools): no overlap-chasing. PostHog's MCP answers "run me a query on raw events." ANYKPI's MCP answers in *founder semantics* — value events, smiles, seat risk, WBR exceptions — and hands back the view. A power-user `run_hogql` passthrough is deliberately **out** of v1; agents that want raw SQL should connect PostHog's MCP alongside.

**The in-app ✦ agent bar**: keeps the instant regex/DSL parser (already good), optionally enhanced by a BYO Anthropic API key for real NL → view-state translation. No key, no degradation of the core product.

## 11. Security & privacy

- Connector secrets encrypted at rest (libsodium secretbox; key file lives beside the DB in the data volume), never in git, never in client bundles.
- Documented least-privilege setup per connector (Stripe restricted key, PostHog personal key scoped to `query:read` + `person:read`, read-only ICS).
- ANYKPI API keys stored hashed; MCP and REST share the same auth.
- Self-hosted means person-level data stays in the founder's infrastructure; **no telemetry** (opt-in later, if ever, per OSS norms).

## 12. Testing & production-grade gates

- **The canon dataset is the permanent test fixture.** The deterministic generators (36 named users, Initech at-risk, cohort seed 777) move to `src/demo` and double as demo mode *and* golden-test input. The pinned facts in the briefs become assertions: "iOS in France = Jo/Zara/Ines/Axel/Sky", "Initech 3/10 activated", "8 smiling cohorts". The PRNG draw-order warning from the learnings log becomes a snapshot test that fails loudly if the stream shifts.
- **Pure functions get unit tests first**: `wbrStat`, `coSlope`, `coFloorOf`, `coGrade`, smile detection, milestone detector, view-state codec round-trip, connector normalizers (fixture JSON in → read-model rows out).
- **Promises suite (Playwright)** against the demo dataset: each phase's PROMISES.md in customer language, executable, green in a real browser before "done" — per house doctrine (`scripts/checks.sh`: typecheck → lint → unit → promises → secret scan → review gates).
- **Demo mode ships forever** — first-run is never empty, and it's what CI tests against.

## 13. Build order (each phase independently shippable)

1. **Skeleton + demo mode.** Fresh repo, MIT, CI, Next.js app; port the prototype into components (shell → dot plot → cohorts → WBR → calendar) reading demo read models; view-state URL codec; MCP endpoint serving demo data (agent-native from day 0, literally). *Promise: `docker run` / `npx anykpi` shows the full dashboard on demo data; an MCP client can query it.*
2. **PostHog connector + real dot plot.** Setup wizard: connect key → pick value events (vanity guard) → first sync → your actual users on the plot. *The flagship goes real first.*
3. **Cohorts on real activity** (derived locally; smile detector on real curves).
4. **WBR engine** — metric config, Stripe connector, manual/CSV sources, targets.
5. **Calendar sources** — ICS, Stripe webhooks, GitHub, RevenueCat, Mercury, milestone detector.
6. **Agent-native polish** — API keys UI, OpenAPI docs, `agents.md` + copyable "let your agent set this up" prompt (the agent installs the SDK snippet, configures value events over MCP, verifies first events arrive — the `npx @posthog/wizard` moment, but any agent).

## 14. Risks & open questions

| Risk | Mitigation |
|---|---|
| PostHog team-wide rate limits are shared with everything else the team runs | Few, coarse queries; incremental windows; document PostHog batch exports as the growth escape hatch |
| HogQL latency on huge event volumes | Sync is background; window is bounded; incremental re-query only trails 3 days |
| Group analytics (B2B seats) is a paid PostHog add-on | `account_id` person-property fallback is first-class, not an afterthought |
| Plaid friction for self-hosters | Mercury-first (see §7); Plaid deferred |
| Google OAuth friction | ICS-first (see §7) |
| Semantic user clusters (L06) need embeddings | v1 ships heuristic clusters (archetype rules over activity shape); embeddings are a later connector-like module |
| NL agent bar needs an LLM | BYO key, optional; DSL parser is the floor; agents use MCP anyway |

**Open (business) questions for Dillon — none block Phase 1:** final repo name/home for the production repo; license confirmation (MIT recommended); whether a hosted waitlist link ships in v1 chrome.

## 15. Explicitly out of scope for v1 (YAGNI)

Own event ingestion/SDKs (PostHog's job) · multi-tenancy/auth-for-teams (self-hosted single-team; hosted version's problem) · alerting/digests · write-paths to any connected source · raw SQL passthrough in MCP · embeddings clustering · Plaid · Google OAuth calendar · mobile app.
