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

## Phase 2 — Admin contest & question-bank CRUD ✅ (complete)

**Goal:** admins can author reusable MCQ/TEXT/CODING questions, assemble them
into contests, manage the invite roster, and publish.

Delivered:

- **API routes** (all `runtime = "nodejs"`, admin+CSRF guarded, zod-validated,
  AuditLog'd):
  - `src/app/api/admin/questions/` — `GET` (paginated, searchable by
    title/tag, filter by type/difficulty/archived), `POST` (create MCQ/TEXT/
    CODING via a discriminated-union schema).
  - `.../questions/[id]/` — `GET` (full detail incl. options/testcases),
    `PATCH` (either `{isArchived}` toggle, or a full replace-all content edit —
    blocked once the question is attached to a non-DRAFT contest), `DELETE`
    (hard-delete only if never attached to a contest, else 409).
  - `src/app/api/admin/contests/` — `GET` (paginated/searchable/status filter),
    `POST` (create DRAFT contest).
  - `.../contests/[id]/` — `GET` (detail incl. ordered questions + roster
    count), `PATCH` (full replace, blocked once `now >= startAt`), `DELETE`
    (only while still DRAFT).
  - `.../contests/[id]/publish` and `.../unpublish` — DRAFT↔SCHEDULED, publish
    requires ≥1 question and (if INVITE_ONLY) ≥1 roster entry.
  - `.../contests/[id]/questions` — `POST` attach, `PATCH` bulk-reorder
    (`{order: [contestQuestionId,...]}`), `DELETE` detach via query param.
  - `.../contests/[id]/participants` — `GET` roster, `POST` bulk-invite by
    user id (INVITE_ONLY only, dupes skipped+reported), `DELETE` remove (only
    if the participant hasn't started).
- **Domain logic:** `src/lib/questions.ts` (per-type zod schemas, sane-range
  checks for coding time/memory, replace-all content transaction, edit-lock
  guard), `src/lib/contests.ts` (contest schema, time-based structural lock
  `isContestLocked`, publish gate `assertPublishable`), `src/lib/scoring.ts`
  (pure MCQ/text/coding scoring + ranking tie-break, ready for Phase 3/6),
  `src/lib/languages.ts` (canonical coding-language vocabulary shared with
  the future Phase 4 executor).
- **UI:** `/admin/questions` (searchable/filterable/paginated table, one
  editor dialog handling all 3 question types with an options editor and a
  test-case editor), `/admin/contests` (list + create dialog), `/admin/
  contests/[id]` (detail builder: editable contest form, attach-from-bank
  panel with up/down reorder, invite-only roster panel, publish/unpublish
  buttons) — all locked read-only once the contest's start time passes.
- **New deps/components:** shadcn `select/tabs/switch/separator`.

**Checkpoint verified** (scripted curl E2E against `bun run dev`, cleaned up
after):

- Created one MCQ, one TEXT, one CODING question; CODING `defaultPoints` came
  back server-computed as the sum of its test-case scores (10). ✅
- Edited the MCQ (replace-all options); archived/unarchived it. ✅
- Publish blocked with no questions (409), blocked again with questions but no
  roster on an INVITE_ONLY contest (409), succeeded once a participant was
  invited → `SCHEDULED`; unpublish → back to `DRAFT`. ✅
- Attached/ordered 3 questions on a contest, fetched detail to confirm order
  0/1/2. ✅
- A contest whose `startAt` was in the past rejected question-attach and
  contest-edit with 409 ("already started"). ✅
- Deleting a question still attached to a contest returned 409 (archive
  instead), matching the Phase 1 participant-delete guard pattern. ✅
- `bunx tsc --noEmit` clean. ⚠️ `bun run build` currently fails on
  `/_global-error` prerendering — confirmed **pre-existing** (reproduced on a
  stash of just the Phase 1 baseline + theme-provider commit, before any Phase
  2 code); see `memory.md` "Known issue" section. Not caused by this phase;
  flagged for a follow-up fix.

## Phase 3 — Participant MCQ/TEXT contest-taking flow ✅ (complete)

**Goal:** participants can see the contests they're eligible for, start within
the contest window, answer MCQ/TEXT questions with a palette + autosave, and
submit (manually or server-detected timeout) with a live, server-resynced
countdown.

Delivered:

- **Post-Phase-2 bugfix (found via manual testing):** `isContestLocked` had
  been wall-clock-based (`now >= startAt`), which permanently bricked any
  contest whose start time passed before anyone actually entered it — no way
  to add questions or invite participants, ever, since Phase 3 didn't exist
  yet to set real participant activity. Changed to activity-based (locked
  only once a `ContestParticipant.contestStartedAt` exists). See `memory.md`.
- **UI bugfixes** (reported as "dropdowns everywhere" + "congested create
  question modal"): `ui/dialog.tsx`'s default width used `sm:max-w-sm`, which
  loses to unprefixed override classes unpredictably (real bug, not just
  taste) — fixed by dropping the breakpoint prefix so overrides always win.
  `ui/select.tsx` defaulted to Radix's `item-aligned` position (pops over the
  selected item, native-`<select>`-style) instead of standard `popper`
  (opens below the trigger) — fixed at the component level. Question editor
  rebuilt with Details/Content tabs instead of one long scroll.
- **Schema:** `Attempt.visited` / `Attempt.markedForReview` (migration
  `attempt_palette_state`) — the palette's 5-state model needs data the
  existing coding-oriented `AttemptStatus` enum couldn't express.
- **API routes** (`runtime = "nodejs"`, participant-role + CSRF guarded):
  - `GET /api/participant/contests` — contests visible to this participant:
    `OPEN` + published, or `INVITE_ONLY` where they have a roster row. Each
    row includes a derived `phase` (`UPCOMING`/`ACTIVE`/`ENDED`, from
    `startAt`/`endAt`) and their own `participantStatus`.
  - `GET .../contests/[id]` — contest state: before starting, just metadata;
    after starting, the full question list (**safe projection** — no option
    scores, no `isCorrect`, no `TextAnswerConfig.correctAnswer`, no
    `solutionCode`), their saved answers, and server-computed
    `remainingSeconds`. Auto-finalizes as `AUTO_SUBMITTED` right here if the
    deadline has silently passed (see `ensureNotExpired`).
  - `POST .../contests/[id]/start` — idempotent start/resume: eligibility
    check (`assertEnterable`), lazily creates the `ContestParticipant` row
    for `OPEN` contests, sets `contestStartedAt` once (never overwritten on
    resume).
  - `PATCH .../contests/[id]/answers/[cqId]` — autosave one MCQ/TEXT answer;
    scored **synchronously** (`computeAnswerScore`, reusing Phase 2's
    `scoring.ts`) since MCQ/TEXT grading is cheap and needs no queue. Always
    marks `visited = true`, so it doubles as the "question opened" signal.
    Rejects `CODING` questions (400 — Phase 4 answers those from the editor).
  - `POST .../contests/[id]/submit` — final submit; re-checks
    `ensureNotExpired` first so a submit racing the deadline can't double
    count, sums all `SUBMIT`-type `Attempt.score` into `totalScore`.
- **Domain logic:** `src/lib/participant-contests.ts` — `contestPhase`,
  `effectiveDeadline` (min of contest `endAt` and personal
  `contestStartedAt + durationMinutes`), `assertEnterable`,
  `ensureNotExpired` (the server-side timeout detector — called from every
  state-reading/mutating route, not just a cron job), `finalizeSubmission`
  (idempotent), `toParticipantQuestion` (the safe projection).
  `src/lib/auth/guards.ts` gained `requireParticipant`.
- **UI:** `/participant` dashboard (phase-badged contest list, Enter/Resume/
  Submitted states), `/participant/contests/[id]` taking flow — start screen,
  question palette (5-state color coding, click-to-navigate), MCQ checkboxes
  (immediate save on toggle) / TEXT input (600ms debounced save), Save & Next
  / Mark for Review & Next / Clear Response / Skip, a live countdown that
  ticks client-side but resyncs from the server every 20s and auto-submits
  at zero, and a submit confirmation dialog. `CODING` questions show a
  Phase-4 placeholder rather than blocking navigation.
- **Scope boundary:** coding questions are visible in the palette/list but
  not answerable yet (Phase 4). Contest `resultsVisibleToParticipants`
  gates whether `totalScore` is echoed back on submit.

**Checkpoint verified** (scripted curl E2E against `bun run dev`, admin +
alice sessions):

- Dashboard listed an `OPEN` contest as `ACTIVE` with `participantStatus:
  null` before starting. ✅
- `start` created the roster row + `contestStartedAt`; detail then returned
  the question list with **no scores/correct-answers leaked** and
  `remainingSeconds: 1800` for a 30-minute contest. ✅
- Saved an MCQ answer (correct option) and a TEXT answer (`"paris "` →
  case-insensitive/trimmed match) — refetching detail after "refresh"
  showed both answers, `visited`, and `markedForReview` exactly as saved. ✅
- `submit` returned `{status:"SUBMITTED", totalScore:10}` (5 + 5, matching
  `scoreMcq`/`scoreText`); a further `PATCH` to an answer 409'd
  ("already submitted"), and `start` 403'd for the same reason. ✅
- **Server-side timeout**: started a 1-minute-duration contest, backdated
  `contestStartedAt` 5 minutes via direct SQL (simulating elapsed time), then
  hit `GET` detail with **no submit call at all** — the participant was
  auto-finalized as `AUTO_SUBMITTED` server-side, proving a candidate can't
  extend time by simply not submitting. ✅
- Role guards: admin got 403 on `/api/participant/*`, participant got 403 on
  `/api/admin/*`. An `INVITE_ONLY` contest alice wasn't invited to returned
  403 on start and was correctly absent from her dashboard list. ✅
- `bunx tsc --noEmit` clean. `bun run build` still blocked by the
  pre-existing `/_global-error` issue (unrelated, see `memory.md`).

## Phase 4 — Coding flow: Monaco + BullMQ + Piston + rate limiting ⏳ (next)

Not started.
