# ANYKPI

**The growth dashboard a founder actually opens every morning — and the first one agents can read too.**

Self-hosted, open-source, built around founder mode: **people, not averages**. One row per person, one column per day. You don't read retention numbers — you _see_ who's sticking, who vanished, who came back after a month away.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Next.js](https://img.shields.io/badge/Next.js-15-black)

## What It Is

ANYKPI is an open-source dashboard. The only step is connecting data.

### Two On-Ramps (both agent-installable)

**Path 1: Connect existing tools**  
PostHog, Mixpanel, Amplitude, Stripe, calendar, GitHub — tools you already pay for. ANYKPI syncs summaries into local read models and never writes back. An agent can do this unattended.

**Path 2: Add ANYKPI events to your product**  
Don't have PostHog/Mixpanel/Amplitude? Add the ANYKPI SDK. Same step, human or agent. Events land in the same read models the connectors write. Self-hosted, person-level data never leaves your machine.

Both paths are first-class.

## Five Views

1. **Dot Plot** — Every user gets a row, every day a column. Streaks and silences read instantly.
2. **Cohorts** — Retention curves that flatten instead of falling to zero. The system tells you when product-market fit is forming.
3. **Weekly Business Review** — The Amazon method. Six trailing weeks beside twelve trailing months, inputs before outputs, exceptions surfaced automatically.
4. **Calendar** — Read-only forever. Payouts, releases, renewals, milestones. Never asks you to enter anything.
5. **PMF+** — Point at a user or group and say "go understand these people." Research, context, sharp questions.

Every view has a shareable URL that is the answer.

## Install

```bash
# One command
npx anykpi@latest

# Or clone and run
git clone https://github.com/anykpi/anykpi.git
cd anykpi
pnpm install
pnpm dev
```

The demo workspace loads automatically. Connect your data to see your people.

## Connect Data

### Path 1: Existing Tools

```bash
# PostHog
POSTHOG_API_KEY=your_key pnpm sync:posthog

# Mixpanel
MIXPANEL_PROJECT_ID=your_project_id MIXPANEL_API_SECRET=your_secret pnpm sync:mixpanel

# Amplitude
AMPLITUDE_API_KEY=your_key AMPLITUDE_SECRET_KEY=your_secret pnpm sync:amplitude
```

Or connect via the UI at `/connect`.

### Path 2: ANYKPI SDK

Add to your app:

```html
<script>
  !function(){
    var anykpi = window.anykpi = window.anykpi || [];
    anykpi.init({
      endpoint: "http://localhost:3000",
      workspaceId: "live",
      debug: true
    });
    anykpi.identify({ 
      userId: "user123", 
      properties: { 
        name: "Jane Doe", 
        email: "jane@example.com",
        platform: "WEB"
      }
    });
  }();
</script>
<script src="http://localhost:3000/sdk.js" async></script>
```

Track events:

```javascript
anykpi.track("song_played", { genre: "jazz" });
anykpi.track("playlist_shared", { recipients: 3 });
```

Configure value events at `/connect` to map your events to ANYKPI's cell grammar (core, search, share, pay).

## Agent Setup

ANYKPI is agent-native from day zero. Give your AI agent access via MCP:

1. Generate an API key at `/connect`
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
- **SQLite + Drizzle** — Fast local read models (Postgres via DATABASE_URL)
- **Tailwind + shadcn** — Linear-light aesthetic
- **Hand-rolled SVG charts** — Seven rounds of prototype learnings baked in
- **MCP** — Streamable HTTP at `/api/mcp`

## Production Deploy

### Docker

```bash
docker build -t anykpi .
docker run -p 3000:3000 -v anykpi-data:/data anykpi
```

### One-Command Install

```bash
npx anykpi@latest
```

Data lives in `./data/anykpi.db`. Back it up. It's yours.

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

MIT licensed. PRs welcome. Read `PRODUCT.md` for binding product rules.

## Hosted Waitlist

Want ANYKPI cloud-hosted with ANYTIME KPI events and multiplayer? [Join the waitlist](https://anykpi.example.com/waitlist).

Self-hosted is free forever.

---

Built with ❤️ for founders who want to see their people.
