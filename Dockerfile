# Multi-stage build producing two targets: `web` (Next.js server) and `worker`
# (BullMQ consumer). They share the same codebase but run as separate containers
# so a misbehaving execution job can't reach the web app's process/filesystem.

FROM oven/bun:1.3-slim AS base
WORKDIR /app
# argon2 ships prebuilt binaries; no build toolchain needed for bun-slim.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY . .
RUN bunx prisma generate
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
