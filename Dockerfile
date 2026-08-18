# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: Prisma's query engine wants glibc and OpenSSL,
# and chasing musl variants is a poor trade for a few megabytes.
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# --- dependencies ------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# ci, not install: installs exactly the lockfile and fails if it disagrees with
# package.json, so a deployed image can never contain versions nobody chose.
RUN npm ci

# --- build -------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The client is generated from the schema, so it must exist before the build
# typechecks anything that imports it.
RUN node node_modules/prisma/build/index.js generate

# Placeholders only. env.ts validates at import, and Next evaluates route
# modules while building - without these the build fails on configuration that
# is genuinely supplied at runtime. Nothing here reaches the image: the build
# stage is discarded, and no request is served from it.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV LEAD_WEBHOOK_SECRET="build-time-placeholder-0123456789"
ENV BUSINESS_NAME="Build"
ENV BUSINESS_COUNTRY_CODE="+1"
ENV AI_PROVIDER="anthropic"
ENV ANTHROPIC_API_KEY="sk-ant-build-time-placeholder"
ENV NEXT_TELEMETRY_DISABLED=1

RUN node node_modules/next/dist/bin/next build

# --- runtime -----------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Never root. A container escape should not start as the machine's owner.
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

# The standalone server carries its own trimmed node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Migrations run at startup, so the schema and the Prisma CLI have to be here.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Installed rather than copied. Copying node_modules/prisma alone left its own
# dependency tree behind and the entrypoint died on MODULE_NOT_FOUND for
# @prisma/config; copying the whole builder node_modules would undo the point
# of a standalone build. Pinned to the lockfile version, not the package.json
# range, so the CLI applying a migration is the one that generated the client.
RUN npm install --no-save --omit=dev prisma@6.19.3 && npm cache clean --force

COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000

# Reports unhealthy while the database is unreachable, so a platform can hold
# traffic off an instance that cannot serve a single page.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
