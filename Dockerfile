FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
RUN corepack enable pnpm && pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN corepack enable pnpm && pnpm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migrations + entrypoint so the container initializes its own schema on a fresh
# volume (the standalone server does not run migrations itself).
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts/docker-entrypoint.mjs ./scripts/docker-entrypoint.mjs
# postgres.js is also imported by db.ts when DATABASE_URL is set. The
# entrypoint still copies it so schema init works before the server starts.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres

RUN mkdir -p /data && chmod 700 /data && chown nextjs:nodejs /data

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_PATH=/data/anykpi.db

# Applies migrations if needed, then starts the Next standalone server.
CMD ["node", "scripts/docker-entrypoint.mjs"]
