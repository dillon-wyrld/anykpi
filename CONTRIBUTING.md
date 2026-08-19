# Contributing to ANYKPI

Thanks for your interest in improving ANYKPI. Bug reports, docs, and code are all
welcome.

## Getting started

```bash
git clone https://github.com/dillon-wyrld/anykpi.git
cd anykpi
pnpm install
pnpm db:init   # creates ./data/anykpi.db and seeds the demo workspace
pnpm dev       # http://localhost:3000
```

Requires Node 20+ and pnpm 10+.

## Before you open a pull request

Run the same checks CI runs — all must pass:

```bash
pnpm tsc --noEmit   # typecheck
pnpm lint           # eslint
pnpm test:unit      # vitest
pnpm build          # production build
pnpm test:e2e       # Playwright (starts its own dev server)
```

Please add or update tests for behavior you change.

## Ground rules

- **Never weaken authentication.** The API surface (`/api/v1/*`, `/api/mcp`) and
  all writes require a valid key; only the `demo` workspace is public-read. If
  you add a route that reads non-demo data or performs a write, gate it with
  `authorize()`/`gate()` from `src/core/auth.ts`. See [SECURITY.md](SECURITY.md).
- **No telemetry.** Person-level data must never leave the machine.
- **Keep it typed.** TypeScript strict mode is on.
- **Validate inputs** with the Zod contracts in `src/core/contracts.ts`.
- **Preserve the product's design constraints** described in the
  [README](README.md) (e.g. the calendar is read-only, nothing sends on its own).

## Commit and PR style

- Keep PRs focused; one concern per PR where possible.
- Describe what changed and why, and reference any related issue.

## Reporting security issues

Please follow [SECURITY.md](SECURITY.md) — do not file security problems as public
issues.
