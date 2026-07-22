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

## Known issue: `bun run build` fails on `/_global-error` (pre-existing, not Phase 2)
- Since the theme-provider commit (`8ea1f87`/`e24899b`, before Phase 2 started),
  `next build` fails prerendering the auto-generated `/_global-error` page:
  `TypeError: null is not an object (evaluating 'k.H.useContext')`. Reproduced on
  a clean stash of Phase 2's changes, so it's unrelated to the contest/question
  work — almost certainly `next-themes`' `ThemeProvider` (in `src/app/layout.tsx`)
  losing context during Next 16 + React 19's static prerender of the global error
  boundary. `bunx tsc --noEmit` and `bun run dev` both work fine; Phase 2 was
  verified via the dev server + scripted curl E2E, not `bun run build`. Needs a
  fix (e.g. a plain `global-error.tsx` that doesn't depend on the provider tree,
  or pinning/patching next-themes) before this is prod-buildable again.

## Phase 2 — question bank & contest domain rules
- **Question edit is replace-all**: PATCH on `/api/admin/questions/[id]` deletes
  and recreates `options` / `textAnswerConfig` / `codingConfig`+`testCases` in one
  transaction (`replaceQuestionContent` in `src/lib/questions.ts`) rather than
  diffing rows. A question's `type` cannot change after creation (create a new
  question instead) — enforced in the route, not just the UI.
- **CODING `defaultPoints` is server-computed**, not admin-entered: it's always
  `sum(testCases.score)` (`codingTotalScore`), recalculated on every create/edit,
  so the stored ceiling can never drift from the actual test cases. MCQ/TEXT
  `defaultPoints` remains admin-entered.
- **Structural lock is activity-based, NOT wall-clock-based** (fixed after a
  real bug): `isContestLocked(contestId)` in `src/lib/contests.ts` is `async`
  and checks whether any `ContestParticipant` row has a non-null
  `contestStartedAt` — i.e. whether someone has actually entered. It is
  **not** `now >= startAt`. The first version used wall-clock time, which
  permanently bricked any contest whose start time passed before Phase 3 (the
  only thing that can set `contestStartedAt`) existed — admins could never add
  questions or invite participants to it again. Once locked, contest field
  edits, question attach/detach/reorder, and roster add/remove are all
  blocked (409). This is independent of the `DRAFT → SCHEDULED` publish state.
- **A question already attached to a non-DRAFT contest is edit-locked**
  (`canEditQuestion` in `src/lib/questions.ts`) — full-block (not just structural
  fields) is the deliberate simple default, so publishing a contest can't be
  silently undermined by editing a question it references afterward.
- **Publish gate** (`assertPublishable`): requires ≥1 attached question, and for
  `INVITE_ONLY` contests ≥1 roster entry (an invite-only contest nobody's invited
  to can never be entered). `OPEN` contests need no explicit roster.
- Delete guards mirror the Phase 1 participant pattern: hard-delete only if
  never referenced (question: no `ContestQuestion`; contest: still `DRAFT`),
  else 409 suggesting archive/unpublish.
- Canonical coding language codes (`c`/`cpp`/`java`/`python`) live in
  `src/lib/languages.ts` — shared vocabulary between the Phase 2 question editor
  and the Phase 4 Piston executor; mapping to Piston's actual runtime slugs is a
  Phase 4 concern, not resolved yet.

## shadcn `ui/` component bugs (found via manual UI testing, fixed at the component level)
- **`ui/dialog.tsx`**: the default width was `sm:max-w-sm`. A consumer
  overriding width with an unprefixed `max-w-*` class (e.g. `max-w-2xl`) does
  NOT reliably win — `sm:` and unprefixed are different twMerge groups, so
  both rules end up in the compiled CSS and whichever has later source order
  wins, which is not guaranteed. Fixed by dropping the `sm:` prefix from the
  base so any override matches the same group and twMerge dedupes correctly.
  Any *new* default-width tweak to `DialogContent` must stay unprefixed for
  the same reason.
- **`ui/select.tsx`**: `SelectContent` defaulted to Radix's
  `position="item-aligned"` (pops the list centered over the *selected item*,
  native-`<select>`-style) instead of `position="popper"` (opens directly
  below the trigger — what every other dropdown, and users, expect). Fixed
  the default; also changed `min-w-36` to match the trigger's width
  (`min-w-(--radix-select-trigger-width)`) so filter dropdowns aren't
  randomly wider/narrower than their trigger.

## Phase 3 — participant contest-taking domain rules
- **`isContestLocked` is activity-based, not wall-clock-based** (see Phase 2
  section above — this was a real bug found via manual testing after Phase 3
  didn't exist yet to generate real activity). `ContestParticipant
  .contestStartedAt` — set only by `POST .../start` — is the sole lock
  trigger now.
- **The palette's 5 states are derived, not stored**: `visited` +
  `markedForReview` (booleans on `Attempt`) plus "has an answer" (computed
  from `selectedOptionIds`/`textAnswer`) combine in `paletteStatus()`
  (`src/components/participant/types.ts`) to produce Not Visited / Not
  Answered / Answered / Marked / Answered & Marked. No separate status enum.
- **MCQ/TEXT are scored synchronously on every autosave**, not deferred to
  submit — `PATCH .../answers/[cqId]` calls `computeAnswerScore` (wraps
  Phase 2's `scoring.ts`) on every save. `POST .../submit` just sums the
  already-computed scores; it does no grading itself. Coding will differ in
  Phase 4 (async via BullMQ/Piston).
- **Timeout is detected server-side on every read, not by a cron job**:
  `ensureNotExpired(contest, contestParticipantId)` is called at the top of
  the detail GET, the answer PATCH, and the submit POST. If
  `now >= effectiveDeadline` and the participant is still `IN_PROGRESS`, it
  finalizes them as `AUTO_SUBMITTED` right there, before doing anything else.
  This is what stops a candidate from "extending" time by simply not calling
  submit — the very next request of any kind closes them out. Verified by
  backdating `contestStartedAt` via direct SQL and confirming a bare `GET`
  (no submit call) flipped status to `AUTO_SUBMITTED`.
- **`effectiveDeadline`** = min(`contest.endAt`, `contestStartedAt +
  durationMinutes`) — a contest has both a global window and a per-participant
  duration once they've started; whichever is tighter wins.
- **Participant-facing question projection strips grading data**:
  `toParticipantQuestion()` never includes `Option.score`/`isCorrect`,
  `TextAnswerConfig.correctAnswer`, or `CodingQuestionConfig.solutionCode`.
  Verified by inspecting the actual GET response body during E2E, not just
  reading the code.
- Coding questions are visible in the palette/question list in Phase 3 but
  the answer route 400s them (`"Coding questions are answered from the code
  editor"`) — the UI shows a placeholder and only allows Skip. Real answering
  arrives in Phase 4.

## Phase 4 — coding execution domain rules & Piston gotchas
- **Piston has no separate `c`/`c++` package**: both languages come from
  installing the single `gcc` package (`bun run piston:install` →
  `scripts/piston-install.ts`), which then exposes runtimes `c` (alias
  `gcc`) and `c++` (aliases `cpp`, `g++`). Don't try to install a `c` or
  `cpp` package by name — it doesn't exist.
- **Piston container has TWO separate timeout ceilings that both default to
  3000ms**: `run_timeout` (wall-clock) and `run_cpu_time` (CPU time). Raising
  only `PISTON_RUN_TIMEOUT` is not enough — a CPU-bound submission (e.g. an
  infinite loop) still gets SIGKILLed at ~3s by the separate `run_cpu_time`
  ceiling, silently ignoring the per-question `timeLimitSeconds` we send in
  the request. Both are set via env vars on the `piston` service in
  `docker-compose.yml`: `PISTON_RUN_TIMEOUT` and `PISTON_RUN_CPU_TIME`,
  both `15000` (matches `CODING_TIME_LIMIT_RANGE.max` from Phase 2). If that
  max range ever changes, update these too. Installed runtime packages
  persist in the `pistondata` volume across `docker compose up -d
  --force-recreate piston`, so recreating for a config change doesn't
  require reinstalling.
- **Monaco option types are string-literal unions in places you'd expect a
  boolean**: e.g. `hover.enabled` is `"on"|"off"|"onKeyboardModifier"`, not
  `boolean`, in the installed `@monaco-editor/react`/`monaco-editor` version.
  When adding new disabled-IntelliSense options, check
  `node_modules/monaco-editor/esm/vs/editor/editor.api.d.ts` for the actual
  `IEditorOptions` field type before assuming `{enabled: false}` works —
  `tsc` will reject it with a slightly confusing "Type 'false' is not
  assignable to..." pointing at the right line but not explaining why.
- **Per-question hard-lock is separate from the contest-wide deadline**:
  `Attempt.questionStartedAt` (set once via `POST .../visit`, never
  overwritten) + `resolveHardLockSeconds` (`ContestQuestion
  .hardLockSecondsOverride ?? CodingQuestionConfig.defaultHardLockSeconds ??
  null`) computes a deadline independent of `effectiveDeadline` (Phase 3).
  Null means no per-question lock — only the contest-wide deadline applies.
  Once `questionStartedAt` is set and the lock expires, there is currently no
  UI-triggered way to reset it (E2E testing needed a direct DB update) — this
  is by design (an expired lock should stay expired), just worth knowing if
  something looks "stuck" while testing.
- **RUN vs SUBMIT scoring split**: RUN attempts test sample cases only and
  never write `score`/`maxPossibleScore` (always `null`); SUBMIT attempts
  test every case (sample + hidden) and are what `finalizeSubmission()`
  (Phase 3) sums into `ContestParticipant.totalScore`. Both attempt types
  reuse the same grading pipeline (`gradeSubmission` in `src/lib/
  execution.ts`) — the RUN/SUBMIT distinction only affects which test cases
  are passed in and whether the worker persists a score.
- **Hidden test-case output redaction happens in TWO places**, not one — both
  the worker's live Redis-publish path (`toParticipantTestCaseResult`,
  `src/lib/execution-events.ts`) and the contest-state GET route's
  persisted-result serialization (`redactHiddenResults`, `.../contests/[id]/
  route.ts`) strip `actualOutput`/`error` for non-sample cases. If a new
  code path ever serializes `testCaseResults` to the participant, it must
  also redact — the raw DB row always has full output for every case.
- **Java requires the public class to be named `Main`** (matches the fixed
  `Main.java` filename in `PISTON_SOURCE_FILENAME`) — not yet surfaced as a
  UI hint to participants; flag for Phase 7 polish.

## Post-checkpoint fixes (bugs found via manual testing after Phase 4)
- **SSE stream TDZ crash** (`.../questions/[cqId]/stream/route.ts`): the
  already-terminal early-return path called `close()`, which did
  `clearInterval(heartbeat)` — but `heartbeat` was declared via `const`
  further down in the same `start()` callback, after the point where
  `close()` could already run. Classic TDZ `ReferenceError`. This silently
  broke the SSE stream for every already-finished attempt (e.g. Run always
  hit it, since Run resolves fast), which is why "Run does nothing, but
  Submit works" was reported — the client's `EventSource` got a 500 and
  `onerror` fired, clearing without ever showing results. Fixed by hoisting
  `let heartbeat: ReturnType<typeof setInterval> | undefined` to the top of
  `start()` and assigning (not re-declaring) it later.
- **Admin contest-builder scroll-to-top on every save** (`contest-detail-
  client.tsx`): `load()` always called `setLoading(true)`, and the component
  renders a full-page spinner in place of everything while `loading` is
  true — so every attach/detach/reorder/save/publish unmounted and remounted
  the entire questions/roster tree, resetting scroll position. Fixed by
  giving `load()` a `{ silent?: boolean }` option; only the very first
  mount-time load shows the spinner, all "reload after a mutation" calls
  pass `{ silent: true }` and just update state in place.
- **Seed `starterCode` for the sample coding question was the full working
  solution**, not a stub (`prisma/seed.ts`, "Sample: Sum of two integers" →
  `print(a + b)`), so the Monaco editor never looked "empty" on first load —
  it was quietly handing participants the answer. Fixed the seed to a stub
  with a `# TODO` comment, and patched the already-seeded DB row directly
  (seed is idempotent/skip-if-exists, so re-running it wouldn't have fixed
  existing data).
- **Sample test cases were never exposed to participants** — `ParticipantQuestion.question.coding` (`src/components/participant/types.ts`)
  had no test-case field at all, and `toParticipantQuestion()`
  (`src/lib/participant-contests.ts`) didn't select or project them. Added
  `sampleTestCases: { id, input, expectedOutput }[]` end-to-end (Prisma
  select in `.../contests/[id]/route.ts` → `toParticipantQuestion` →
  participant `types.ts` → rendered above the editor in
  `coding-question-panel.tsx`). Only `isSample: true` cases are ever
  selected/sent — hidden cases still never reach the client.
- Confirmed (no change needed): sample pass/fail results already persist
  across further code edits — `liveResults` in `coding-question-panel.tsx`
  is only reset to `null`/`[]` inside `handleRun`/`handleSubmitCode`, so it
  survives typing in the editor after a run finishes. The "results
  disappear" symptom the user saw was actually caused by the SSE TDZ crash
  above (the `final` event with results never arrived in the first place).
- **Explicitly deferred per user instruction**: admin-side visibility into
  participant coding results/code is not implemented — user said it's fine
  to leave for a future phase (likely folds into Phase 6's per-participant
  drill-down).
