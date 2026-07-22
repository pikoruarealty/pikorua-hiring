# Assessment Platform

Timed MCQ / TEXT / coding contests for candidate shortlisting. See
`initial-prompt.md` for the original spec, `progress.md` for what's actually
built phase by phase, `tasklist.md` for the granular checklist, and
`memory.md` for non-obvious gotchas, bugs, and decisions — **read `memory.md`
before touching `next`, the `Dockerfile`, or your package manager**, it has a
load-bearing upstream Next.js bug workaround documented there.

`AGENTS.md` also matters: this project pins a specific Next.js version with
real breaking changes from what you might expect — check
`node_modules/next/dist/docs/` before assuming an API works the way you
remember.

## Package manager: **bun**, not npm/yarn/pnpm

This is not a style preference — `patchedDependencies` in `package.json`
(see `patches/`) is a Bun-specific mechanism that other package managers
silently ignore. Using `npm install` instead of `bun install` will produce a
build that's missing a required upstream-bug workaround; see `memory.md`'s
"RESOLVED: `/_global-error`" section for what breaks and why.

## Getting started (local dev)

```bash
docker compose up -d postgres redis piston   # infra only — postgres on host 5544, not 5432
bun install
cp .env.example .env                          # fill in real values
bunx prisma migrate dev
bun run db:seed                                # admin / alice / bob dev accounts, see memory.md
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Common commands

```bash
bun run dev            # Next dev server (Turbopack)
bun run build           # production build — see memory.md before debugging failures here
bun run lint            # eslint
bunx tsc --noEmit        # typecheck
bun run db:studio       # Prisma Studio
bun run worker          # BullMQ worker (code execution queue, Phase 4+)
```

## Full-stack via Docker

```bash
docker compose --profile app up --build   # web + worker + infra, all containerized
```

## Deploying

CI/CD lives in `.github/workflows/deploy.yml` (GHCR build + push, then SSH to
a VM where `ops/hiring-app.service` — a systemd unit — owns the `web`/
`worker` container lifecycle). See `progress.md`'s "Deploy pipeline" section
for the full picture and `docker-compose.prod.yml` for how the VM resolves
prebuilt images instead of building locally.
