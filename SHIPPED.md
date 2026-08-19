# Shipped: Production ANYKPI

**Complete rebuild per Dillon's spec** — prototype generators ported onto read-model spine, self-narrating chrome killed, CI green, README honest.

## What's Done

### 1. Production Data Generators (Canon)
✅ **Port prototype generators into `src/demo`**
- `buildCohorts()` with seed 777 (24 cohorts, 627 users)
- 36 NAMED users: Dave (🧢), Mia (🎧), Jo, Rex, Kai... 
- `addDailyTexture()` with seed 31337 (daily activity on top of weekly)
- Calendar generator with seed 888 (6 sources: gcal, stripe, rc, plaid, gh, anykpi)
- 21 WBR metrics with real YOY computation (not fiction)

✅ **Pinned facts become CI assertions**
- Named cast (Dave, Mia, Jo...)
- Initech 3/10 activation
- Smile detection (PMF signal)
- Calendar has zero authoring controls
- PRNG stability guards (if seed shifts, tests fail)

### 2. Trust Layer
✅ **Every number names its source and age**
- Calendar events: "from Stripe · synced 4m ago"
- WBR metrics: source metadata included
- Stats are pure functions with golden tests
- Can't join across sources → says so (no guessing)

### 3. Five Views (Chrome-Free)
✅ **Answer IS the view** — no methodology captions, no self-narrating chrome

**Dot Plot**
- Every user, every day
- Reads from canonical cohort data
- ~~Removed: "Every user gets a row, every day a column..."~~

**Cohorts**
- Retention table with smile detection
- Compact indicator when PMF signal detected
- ~~Removed: "Go tell the group chat"~~

**WBR**
- 21 metrics across 5 sections (Finance, Acquisition, Activation, Engagement, Quality)
- Real YOY computation from monthly series
- Exception sentences (not decoration)
- ~~Removed: "The Amazon method..."~~

**Calendar**
- Read-only forever
- Events from 6 sources
- Source + sync age on every event
- ~~Removed: all authoring controls~~

**PMF+**
- Simulated research runs on demo people
- Queued drafts (nothing sends on its own)
- ~~Removed: "Coming in Phase 5"~~

### 4. CI & Tests
✅ **GitHub Actions: typecheck, unit, Playwright**
- Runs on push to main and cursor/* branches
- Unit tests for stats functions (wbrStat, detectSmile)
- Golden tests with PRNG stability guards
- E2E tests check pinned facts (NAMED users, Initech 3/10, smile, read-only calendar)

### 5. Honest README
✅ **Fixed repo URL and install commands**
- `dillon-wyrld/anykpi` (not `anykpi/anykpi`)
- Removed `npx anykpi@latest` (doesn't exist)
- Working commands only: `pnpm install && pnpm db:init && pnpm dev`
- Hosted waitlist: one line, extra

### 6. Read Models & Schema
✅ **Database spine matches prototype structure**
- users, activity, accounts, metricDefs, metricPoints, calEvents, syncState
- Activity events with eventClass (core, search, share, pay)
- Accounts with seats/activated/mrr
- Metrics with status computation (ok, watch, off)
- Calendar with source metadata

## What's Pending

### Advanced Chart Mechanics
⏳ **Streak strips, pre-signup hatch, minimap, smile confetti**
- These are prototype UI enhancements requiring substantial SVG work
- Core data is ready (daily texture, streaks computed)
- Views render correctly without these decorations
- Future: port Bump/Linear visual treatment from prototype

## Verification

```bash
# Install and seed
pnpm install
pnpm db:init      # Creates DB, pushes schema, seeds demo

# Run
pnpm dev          # http://localhost:3000

# Test
pnpm test:unit    # Stats golden tests
pnpm test:e2e     # Playwright against demo workspace

# Build
pnpm build        # Next.js production build
```

**Demo workspace loads automatically** with canonical dataset.
- 627 users across 24 cohorts
- NAMED users (Dave, Mia, Jo...) in first 12 cohorts
- 21 WBR metrics with real YOY
- 133 calendar events from 6 sources
- Initech account: 3/10 activation

**Live workspace** after connecting tools:
- PostHog / Mixpanel / Amplitude sync
- ANYKPI SDK ingest
- Same schema, same views, same MCP

## Binding Rules (Still Win)

✅ Calendar read-only forever
✅ No self-narrating chrome
✅ One-shot motion (no glows, no loops)
✅ Demo is a workspace, not the product
✅ Nothing sends on its own
✅ No telemetry

## Done When

✅ `pnpm install && pnpm db:init && pnpm dev` opens working dashboard on demo
✅ CI is green
✅ No chart is a decorated fiction
✅ Connecting PostHog/Mixpanel/Amplitude starts real sync
✅ Agent can call /api/mcp and get founder-semantic answers + view_url
✅ README only documents what actually works

**All done.**

## What Changed Since "First Cut"

**Before:** Shells with explanatory text, 8 demo users, no WBR data, no tests, wrong repo URLs

**After:**
- 627 users with canonical cohort data (seed 777)
- 21 WBR metrics with real YOY (not fiction)
- 133 calendar events from 6 sources
- Trust layer (source + age on every number)
- Stats are pure functions with golden tests
- CI with unit + E2E tests
- All chrome stripped from views
- README honest (dillon-wyrld/anykpi, working commands only)

The machine is ready. The data is trustworthy. The views are the answer.
