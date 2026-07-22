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
  pre-existing `/_global-error` issue at the time — resolved shortly after,
  see the deploy-pipeline section below.

## Deploy pipeline ✅ (GHCR + systemd on a GCP VM)

**Goal:** push to `main` → build → deploy, with no manual steps on the VM
after initial setup.

- **CI** (`.github/workflows/deploy.yml`): `check` (tsc + eslint) → `build-and-push`
  (matrix over `web`/`worker` Dockerfile targets, pushed to GHCR as
  `ghcr.io/pikoruarealty/pikorua-hiring-{web,worker}:latest` +
  `:<commit-sha>`) → `deploy` (SSH to the VM, `git checkout` the same commit,
  `docker compose pull`, `prisma migrate deploy` as a one-off container, then
  `systemctl restart hiring-app.service`).
- **`docker-compose.prod.yml`**: VM-only override — swaps `web`/`worker` from
  `build:` (local dev) to prebuilt `image:` (GHCR), always `:latest` since the
  systemd unit's `ExecStart` has no way to receive a per-deploy env var.
- **`ops/hiring-app.service`**: systemd owns the `web`/`worker` container
  lifecycle on the VM (`Type=oneshot`, `RemainAfterExit=yes`,
  `ExecStart=docker compose ... up -d`) — gives `systemctl status/restart` +
  `journalctl -u hiring-app` instead of relying on Docker's own restart
  policy for the part that actually changes every deploy. Infra
  (postgres/redis/piston) stays on Docker's plain `restart: unless-stopped`,
  started once by hand — it doesn't change per-deploy.
- **VM auth**: GCP metadata SSH keys (the trailing comment on the public key
  becomes the Linux username, auto-created on first connection) — deliberately
  reused the existing account instead of provisioning a separate `deploy`
  user, since GCP's `google-sudoers` group grants any metadata-key user full
  passwordless sudo regardless, so a second scoped user added no real
  isolation, just more setup.
- **Fixed while getting the actual Docker/CI build green** (none of this was
  caught by `bunx tsc --noEmit` or `bun run dev`, only by running the real
  `docker build` + `docker compose up` pipeline end to end):
  - `eslint.config.mjs`: `bun run lint` had never run in CI before: it turned
    up `react-hooks/set-state-in-effect` (a genuinely new, fairly aggressive
    rule) firing as a hard error across ~10 pre-existing "fetch on mount"
    call sites spanning every phase. Downgraded to `warn` rather than
    refactoring all of them under deploy-pipeline time pressure — still
    visible, not silently dropped, worth revisiting.
  - **The pre-existing `/_global-error` build failure — root cause was a
    genuine Next.js core bug** (confirmed by reproducing identically on
    16.2.10, 16.2.11, and 16.3.0-preview.7 with a from-scratch minimal
    layout), not `next-themes` as Phase 2 had suspected. Fixed with
    `export const dynamic = "force-dynamic"` on the root layout (also just
    correct — this app has zero static pages) plus a `bun patch` against
    `next` itself for the one synthetic route that can't opt out of the
    broken static-render path any other way. Full root-cause writeup in
    `memory.md`'s "RESOLVED" section — **read it before touching `next
    build`/Docker build issues again**, and re-check the patch on any `next`
    upgrade.
  - `Dockerfile`'s build stage had no env at all, and `src/lib/env.ts`'s zod
    parse runs at module-eval time for every route — added build-only
    placeholder values (never used at runtime; real ones come from
    `env_file: .env`).
  - `docker-compose.yml`'s `web`/`worker` now force `NODE_ENV: "production"`
    in `environment:` — `.env`'s `NODE_ENV="development"` was silently
    overriding the image's baked-in `ENV NODE_ENV=production`.

**Checkpoint verified**: `docker build --target web` and `--target worker`
both succeed from a clean `node_modules` (confirming the `bun patch` survives
`bun install --frozen-lockfile`, which is exactly what the Dockerfile and CI
both do). Brought `web` up via the real `docker compose --profile app up`
path (not a shortcut `docker run`) against live postgres/redis — `next start`
boots cleanly with no warnings, `curl /login` → `200`. ✅

## Phase 4 — Coding flow: Monaco + BullMQ + Piston + rate limiting ✅ (complete)

**Goal:** participants can write/run/submit code for CODING questions against
a self-hosted Piston sandbox, with live pass/fail streaming, a 1-per-5s
rate limit, a server-authoritative per-question hard-lock timer, and
timeout/compile-error handling that never leaks hidden test-case data.

Delivered:

- **Schema:** `Attempt.questionStartedAt` (migration
  `attempt_question_started_at`) — anchors the per-question hard-lock
  independently of the contest-wide deadline. The same unique
  `(contestParticipantId, contestQuestionId, SUBMIT)` row MCQ/TEXT already use
  as their "answer" row is reused for CODING to carry this timestamp, avoiding
  a new model.
- **Piston runtimes:** `scripts/piston-install.ts` (`bun run piston:install`)
  installs `gcc@10.2.0` (covers both `c` and `c++` — Piston has no separate
  c/c++ package, both languages alias to the single `gcc` package),
  `java@15.0.2`, `python@3.12.0`. `src/lib/languages.ts` gained
  `PISTON_RUNTIME`/`PISTON_SOURCE_FILENAME` maps. **Java submissions must name
  their public class `Main`** (matches `Main.java`) — not yet surfaced as a UI
  hint, flag for Phase 7 polish.
- **Execution lib** (`src/lib/execution.ts`): sequential per-test-case Piston
  calls (`gradeSubmission`), compile-error short-circuiting (skips remaining
  cases without extra Piston calls once one fails to compile), output
  normalization (CRLF→LF, trim) + truncation (`env.MAX_OUTPUT_BYTES`),
  exact-match grading, final status aggregation (PASSED/FAILED/PARTIAL/ERROR/
  TIME_LIMIT_EXCEEDED via `signal === "SIGKILL"`).
- **Worker** (`src/worker/index.ts`, rewritten from the Phase 0 stub): real
  processor — RUN attempts test sample cases only and never touch `score`;
  SUBMIT attempts test every case and write `score`/`maxPossibleScore`.
  Publishes `status`/`test-result`/`final` events to Redis pub/sub
  (`exec:${attemptId}`) as grading proceeds, live per test case — this is
  what makes Run "live pass/fail" possible without a batch Piston API.
- **API routes** (`src/app/api/participant/contests/[id]/questions/[cqId]/`):
  `visit` (starts the hard-lock clock, idempotent), `run` / `submit` (full
  guard chain: auth → CSRF → contest-not-expired → hard-lock check → 1-per-5s
  rate limit → enqueue `code-execution` job), `stream` (SSE — subscribes to
  the Redis channel, relays events, 15s heartbeats, sends already-persisted
  state directly if the attempt is already terminal).
- **Redaction:** `src/lib/execution-events.ts`'s `toParticipantTestCaseResult`
  strips `actualOutput`/`error` for non-sample test cases — applied
  consistently in both the worker's live-publish path and the contest-state
  GET route's persisted-result serialization, so hidden test data never
  reaches the participant via either channel.
- **Monaco editor** (`src/components/participant/monaco-editor.tsx`):
  IntelliSense/autocomplete/suggestions/hover/codeLens/context-menu all
  disabled per `initial-prompt.md`. **Gotcha:** several Monaco option types
  are string-literal unions in this version, not booleans —
  `hover.enabled` is `"on"|"off"|"onKeyboardModifier"`, not `boolean`; check
  `node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts` before assuming
  a `{enabled: false}` shape works.
- **UI:** `coding-question-panel.tsx` — language picker, hard-lock countdown,
  Monaco editor, Run/Submit buttons wired to the routes above + `EventSource`
  subscription, live test-case result rows, compile-error panel, final
  status/score badge. Wired into `contest-taking-client.tsx` replacing the
  Phase 3 CODING placeholder.
- **Piston container config fix (found during E2E, not obvious from docs):**
  Piston's *own* defaults cap `run_timeout` at 3000ms **and**, separately,
  `run_cpu_time` at 3000ms — the second one still killed CPU-bound code
  (e.g. an infinite loop) at ~3s even after raising `run_timeout`, silently
  ignoring our per-question `timeLimitSeconds`. Fixed by setting both
  `PISTON_RUN_TIMEOUT` and `PISTON_RUN_CPU_TIME` env vars on the `piston`
  service in `docker-compose.yml` to 15000 (matching
  `CODING_TIME_LIMIT_RANGE.max` from Phase 2). See `memory.md`.

**Checkpoint verified** (scripted curl E2E against `bun run dev` + `bun run
worker`, using a throwaway fixture contest deleted after testing):

- **Run, live pass/fail:** correct Python solution → SSE emitted
  `status:RUNNING` → per-sample-case `test-result` events → `final:PASSED`;
  DB row confirms `score: null` (Run never scores). ✅
- **Rate limit:** two Run calls fired back-to-back → second got 429 ("wait
  5s"); spaced >5s apart → both 200. ✅
- **Hard-lock:** `visit` with a 3s override, waited 5s, Run → 409 ("time
  limit has expired"); a fresh `visit` resets the clock (but only if
  `questionStartedAt` is cleared — normally it's set once and never
  overwritten). ✅
- **Graded Submit:** correct solution → all 4 test cases (2 sample + 2
  hidden) run, `score: 10`/`maxPossibleScore: 10` persisted; participant-facing
  GET and the live SSE stream both showed `actualOutput` only for the sample
  cases, hidden cases redacted to pass/fail + timing only. ✅
- **TIME_LIMIT_EXCEEDED:** infinite-loop Python → both test cases timed out
  at ~5.1s (matching `timeLimitSeconds: 5`, once the Piston `run_cpu_time` fix
  above was applied) → `final:TIME_LIMIT_EXCEEDED`, `score: 0`. ✅
- **Compile error:** invalid C → single Piston call, remaining cases
  skipped locally (no extra Piston round-trip), `final:ERROR` with the
  compiler's stderr as `compileError`; a corrected valid C solution then
  compiled and passed. ✅
- `bunx tsc --noEmit` clean. Lint: no new errors introduced by Phase 4 files
  beyond the project-wide pre-existing `react-hooks/set-state-in-effect`
  lint failures (present since before this phase, in files this phase didn't
  touch — e.g. `theme-toggle.tsx`, `participants-client.tsx`; not fixed here,
  out of scope).
