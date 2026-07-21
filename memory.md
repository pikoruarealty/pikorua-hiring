# Memory — project gotchas & key decisions

Durable, non-obvious facts a future session (or contributor) needs. The full
rationale lives in the approved plan; this is the "don't trip over these" list.

## Toolchain / framework specifics
- **Package manager is bun**, EXCEPT `prisma migrate` — bunx has issues with it,
  so migrations run via `npx` (see `db:migrate` script). `bun run db:seed`,
  `bun run worker`, etc. are fine.
- **Next.js 16** (not the training-data Next). Key differences:
  - `middleware.ts` is renamed to **`proxy.ts`** (function `proxy`, defaults to
    Node.js runtime). Ours is at `src/proxy.ts`.
  - Docs recommend NOT using the proxy as the sole auth check — real session/role
    validation happens in route handlers + layouts via `src/lib/auth/guards.ts`.
    The proxy only does cookie-presence redirects + security headers.
  - `cookies()` / `headers()` from `next/headers` are **async** (await them).
  - Bundled docs live in `node_modules/next/dist/docs/` — consult before assuming
    an API.
- **Prisma 7** (major changes vs v5/v6):
  - New `prisma-client` generator outputs TS to **`src/generated/prisma`**
    (ESM, uses `import.meta`). Import `PrismaClient` from
    `@/generated/prisma/client`, enums from `@/generated/prisma/enums` (enums are
    `const` objects, not TS enums).
  - **Requires a driver adapter** — no built-in connector. We use `@prisma/adapter-pg`
    (`new PrismaPg({ connectionString })`). Both `src/lib/db.ts` and `prisma/seed.ts`
    construct it.
  - Config is in `prisma.config.ts` (loads `.env` via `import "dotenv/config"`),
    not the schema's datasource block. `--skip-generate` is NOT a valid migrate flag.
  - Schema DSL can't express CHECK constraints — coding limit ranges (time 1-15s,
    mem 16-512MB) are enforced by a hand-written migration SQL + zod.
- **argon2**: the hash-options type is `argon2.HashOptions` (not `Options`). No
  bundled `.d.ts` under a normal path; types are in `argon2.d.cts`.
- **server-only** package is NOT installed and breaks bun-run scripts — do not
  import it in shared modules (env/db) that seed/worker import.

## Local infra / docker
- Host had a **native postgres on 5432** and leftover `pikorua-hiring-*` +
  `piston_api` containers (stopped, user approved). Our compose postgres is
  published on host **5544** to avoid the conflict; redis 6379, piston 2000.
- **Docker gotcha:** if `docker compose up` partially fails on a port conflict,
  the created container may start later WITHOUT its host port binding
  (`NetworkSettings.Ports` = `{}`). Fix: `docker compose up -d --force-recreate <svc>`.
  Hit this on both postgres and redis during Phase 0.
- Infra-only dev: `docker compose up -d postgres redis piston` then `bun run dev`
  + `bun run worker` on the host. Full containerized stack: `--profile app`.

## Auth model (as implemented)
- Login identifier is **username** (email is optional metadata; no email infra).
- Session cookie `contest_session` (httpOnly); CSRF cookie `contest_csrf`
  (readable, echoed in `x-csrf-token` header). SameSite=Strict; Secure in prod only.
- Single-active-session enforced for PARTICIPANT via `User.sessionVersion`; ADMIN
  may have concurrent sessions.
- Client mutations must go through `apiFetch` (`src/lib/client/api.ts`) so the
  CSRF header is attached.

## Credential model (Phase 1)
- Only password **hashes** are stored — plaintext is never persisted. So the
  password is revealed exactly ONCE by whatever operation issues it, and can't be
  retrieved later, only **re-issued**.
- **Single create** (`POST /api/admin/participants`) issues + returns the password
  once (shown in a dialog). **Bulk import** creates *dormant* accounts
  (`passwordHash = "pending"`, unusable) and does NOT reveal passwords — you must
  Export to issue them.
- **Export** (`POST /api/admin/participants/export`, csv|pdf) is the credential
  delivery step: it **RE-ISSUES a fresh password** for each selected participant
  (invalidating any previously exported one), then streams the file. Rate-limited
  (5/min/admin) + AuditLog'd. ⚠️ Exporting resets passwords — exporting `scope:all`
  will reset the seeded alice/bob passwords too; re-run `db:seed` to restore them.
- PDF is generated server-side with **pdf-lib** (pure JS, bundles cleanly in the
  Next server runtime — no headless browser / native deps). CSV is hand-rolled
  (`src/lib/csv.ts`, RFC-4180-ish, BOM for Excel).
- Bulk import (`src/lib/participants.ts` + `.../bulk-import`): per-row validation,
  one bad row never fails the batch. **Explicit** duplicate usernames are
  skipped+reported; **blank** usernames are auto-generated (`cand-xxxxxx`, suffixed
  on collision). Header row required; column aliases mapped (name→fullName, etc.).
- AuditLog diffs carry usernames + counts only — **never** passwords/hashes.
- Dynamic route params are async in Next 16: `ctx: { params: Promise<{id}> }`,
  `await ctx.params` (see `.../participants/[id]/route.ts`).

## Dev credentials (seed, NEVER prod)
- admin / `Admin@12345` · alice / `Alice@12345` · bob / `Bobby@12345`
- Re-running `bun run db:seed` resets these passwords (idempotent upsert).
