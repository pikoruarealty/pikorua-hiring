# Multi-stage build producing two targets: `web` (Next.js server) and `worker`
# (BullMQ consumer). They share the same codebase but run as separate containers
# so a misbehaving execution job can't reach the web app's process/filesystem.

FROM oven/bun:1.3-slim AS base
WORKDIR /app
# argon2 ships prebuilt binaries; no build toolchain needed for bun-slim.
COPY package.json bun.lock* ./
# patches/ carries a bun-patch workaround for an upstream Next.js build bug
# (see patches/next@*.patch) — must be present before install so bun can
# reapply it.
COPY patches ./patches
RUN bun install --frozen-lockfile

FROM base AS build
COPY . .
RUN bunx prisma generate
# `next build` statically evaluates every route module (page-data collection),
# which imports src/lib/env.ts's zod-validated env — these placeholders only
# need to satisfy that shape check at build time. The real values come from
# `env_file: .env` at container runtime (docker-compose.yml) and are never
# read from these.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    REDIS_URL="redis://localhost:6379" \
    PISTON_API_URL="http://localhost:2000" \
    APP_SECRET="build-time-placeholder-not-used-at-runtime-0000"
RUN bun run build

# --- web ---
FROM base AS web
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/next.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
EXPOSE 3000
CMD ["bun", "run", "start"]

# --- worker ---
FROM base AS worker
ENV NODE_ENV=production
COPY --from=build /app/src ./src
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/tsconfig.json ./
CMD ["bun", "run", "worker"]
