# Progress

Living log of what's built, phase by phase. See `tasklist.md` for the granular
checklist and the approved plan for scope.

## Phase 0 — Scaffolding, schema, auth, infra ✅ (complete)

**Goal:** a running skeleton where you can log in as a seeded admin or participant
and see role-appropriate empty dashboards.

Delivered:

- **Stack:** Next.js 16 (App Router, Turbopack, TS strict), React 19, Tailwind 4,
  shadcn/ui (radix base). Package manager: **bun** (migrations use `npx` — see
  `memory.md`).
- **Database:** PostgreSQL 16 via Prisma 7 (new `prisma-client` generator →
  `src/generated/prisma`, `pg` driver adapter). Full schema for Phases 0–6 in
  `prisma/schema.prisma`. Two migrations applied: `init` + `coding_limit_checks`
  (CHECK constraints for coding time/memory limits).
- **Infra:** `docker-compose.yml` with postgres, redis, piston (+ `app`-profile
  `web`/`worker` built from `Dockerfile`). Postgres published on host **5544**
  (host 5432 is a native postgres), redis on 6379, piston on 2000.
- **Auth (hand-rolled, no library):**
  - argon2id hashing (OWASP params) — `src/lib/auth/password.ts`.
  - Opaque session token in httpOnly+Secure+SameSite=Strict cookie; only the
    SHA-256 hash stored in the `Session` table — `src/lib/auth/session.ts`.
  - Single-active-session for PARTICIPANT via `User.sessionVersion` (bumped on
    login, checked every request); ADMIN exempt (concurrent sessions).
  - Signed double-submit CSRF bound to session id — `src/lib/auth/csrf.ts`.
  - Route-handler guards (`requireUser`/`requireAdmin`/`requireCsrf`) — auth
    verified in routes/layouts, not the proxy — `src/lib/auth/guards.ts`.
  - Routes: `POST /api/auth/login` (IP rate-limited), `POST /api/auth/logout`,
    `GET /api/auth/me`, `POST /api/auth/change-password`.
- **Security headers:** `src/proxy.ts` (Next 16's renamed middleware) sets
  X-Frame-Options DENY, CSP frame-ancestors none, nosniff, HSTS, Permissions-
  Policy, and does coarse cookie-presence redirects for `/admin` + `/participant`.
- **UI:** login page, admin dashboard (live seed counts), participant dashboard,
  shared header with logout. shadcn Card/Input/Label/Button/Sonner.
- **Queue/worker:** `src/lib/queue.ts` (BullMQ `code-execution` queue) + a no-op
  worker stub `src/worker/index.ts` that connects and logs jobs (real Piston
  processing lands in Phase 4).
- **Seed:** `prisma/seed.ts` — admin + 2 participants + one sample question of
  each type (MCQ/TEXT/CODING).

**Checkpoint verified:**

- `docker compose up -d postgres redis piston` + `bun run dev`.
- Admin/participant login, `/api/auth/me`, role-scoped dashboards all 200.
- Single-active-session: second participant login invalidates the first. ✅
- CSRF: mutating route 403s without header, 200 with. ✅
- Password change works; new password logs in. ✅
- `bun run build` passes (tsc + all routes). ✅
- Worker connects to Redis and reaches "ready". ✅

**Dev credentials (seed):** admin / `Admin@12345`, alice / `Alice@12345`,
bob / `Bobby@12345`.

## Phase 1 — Admin participant management + bulk import/export ✅ (complete)

**Goal:** admins can create/search/edit/delete candidate accounts, bulk-import
from CSV, and export login credentials as CSV or PDF.

Delivered:

- **API routes** (`src/app/api/admin/participants/*`, all `runtime = "nodejs"`,
  admin+CSRF guarded, zod-validated, AuditLog'd):
  - `GET /` — paginated (20/pg), searchable (username/name/email), active filter.
  - `POST /` — single create; issues + returns a one-time password.
  - `PATCH /[id]` — edit profile/activation; deactivate bumps `sessionVersion`
    (kills live sessions).
  - `DELETE /[id]` — hard-delete only if no contest history, else 409 (deactivate).
  - `POST /bulk-import` — CSV (header row + aliased columns), per-row validation,
    dupes/invalid skipped+reported, one bad row never fails the batch (≤2000 rows).
  - `POST /export?format=csv|pdf` — **re-issues** passwords and streams the file;
    rate-limited (5/min/admin) + AuditLog'd.
- **Credential model:** only hashes stored → passwords revealed once at issue,
  re-issued (never retrieved) via Export. Bulk import creates dormant accounts
  (`passwordHash="pending"`); Export is the credential-delivery step. See
  `memory.md`.
- **Lib:** `src/lib/participants.ts` (zod schemas, username rules, credential
  issuance, unique-username generation), `src/lib/csv.ts` (RFC-4180-ish
  parse/serialize + Excel BOM), `src/lib/pdf-credentials.ts` (pdf-lib, paginated
  A4 table), `src/lib/audit.ts` (append-only audit helper, tx-aware).
- **UI:** `/admin/participants` — searchable/paginated table with row selection,
  Add/Edit/Delete dialogs, CSV import dialog (paste or file + skip report),
  one-time credential reveal dialog, Export dropdown (selected/all → PDF/CSV).
  Admin sub-nav (`AdminNav`) + dashboard link added.
- **New deps:** `pdf-lib`; shadcn `table/dialog/alert-dialog/badge/checkbox/`
  `dropdown-menu/textarea`.

**Checkpoint verified** (scripted curl E2E against `bun run dev`):

- Bulk-import 23 rows → 21 created, 2 skipped (explicit dup username + invalid
  username), each with a reason; blank-username row auto-generated `cand-xxxxxx`. ✅
- Export PDF (`%PDF-1.7`, valid) and CSV (BOM + all participants). ✅
- Logged in as an imported participant with the **exported** password. ✅
- Single-active-session: a 2nd concurrent login invalidated the 1st session. ✅
- CSRF 403 without header; duplicate-create 409; edit/deactivate/delete OK. ✅
- AuditLog rows for every action; **no passwords/hashes** in any diff. ✅
- `bun run build` passes (tsc + all routes). ✅

## Phase 2 — Admin contest & question-bank CRUD ⏳ (next)

Not started.
