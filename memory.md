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

## RESOLVED: `bun run build` / Docker build failing on `/_global-error` (was blocking the deploy pipeline)
- **Root cause, confirmed by direct investigation, not guesswork**: this is a
  genuine bug in Next.js itself (reproduced identically on 16.2.10, 16.2.11,
  and 16.3.0-preview.7; with a bare-minimum `layout.tsx` + no custom
  `global-error.tsx`; with a custom one; with `output: "standalone"`) — **not**
  `next-themes`/`ThemeProvider` as originally suspected in Phase 2 (a
  from-scratch minimal layout crashed identically). `next build`'s
  `isPageStatic()` (`node_modules/next/dist/build/utils.js`) unconditionally
  returns `isStatic: true` for the synthetic `/_global-error` route — that
  field isn't even the thing gating the crash, though; the real gate is in
  `node_modules/next/dist/build/index.js`, where any app route with no
  dynamic params gets unconditionally added to `staticPaths` (queued for the
  static-render worker) regardless of the `dynamic` export. `/_global-error`
  can never opt out via `export const dynamic = "force-dynamic"` because Next
  hardcodes it into that unconditional branch — the static-render worker
  itself then crashes rendering it: `TypeError: null is not an object
  (evaluating 'k.H.useContext')` (React's dispatcher, `H`, is null — the hook
  call happens outside a real render pass).
- **Two-part fix**:
  1. `src/app/layout.tsx` now exports `export const dynamic = "force-dynamic"`
     — correct anyway, since this whole app is an authenticated dashboard with
     zero static/marketing pages and no page reads `cookies()`/`headers()`
     server-side to give Next an automatic dynamic signal. This alone fixed
     all 11 real routes (they'd been silently hitting the *same* crash before
     this — `/admin/questions` failed identically to `/_global-error` until
     this was added).
  2. `/_global-error` itself still can't be forced dynamic from userland, so
     it's patched directly via `bun patch` — see `patches/next@16.2.11.patch`.
     The patch adds one guard in `build/index.js`: if
     `originalAppPath === "/_global-error/page"`, skip the unconditional
     static-marking branch entirely, leaving it dynamic. `bun install`
     reapplies this patch automatically (verified with a clean
     `rm -rf node_modules && bun install --frozen-lockfile`) as long as
     `patches/` ships alongside `package.json`/`bun.lock` — the `Dockerfile`
     now `COPY patches ./patches` *before* `bun install` in the `base` stage
     for exactly this reason. **If `next` gets upgraded, re-verify this patch
     still applies/is still needed** (`bun patch next`, re-diff against the
     new `build/index.js`, `bun patch --commit`) — a future Next release may
     fix this upstream, at which point the patch (and this note) can be
     deleted.
- **Confirmed as a known, still-unresolved upstream Next.js 16 bug**, not
  something guessed at from local investigation alone — matches
  [vercel/next.js#84994](https://github.com/vercel/next.js/issues/84994),
  [#86178](https://github.com/vercel/next.js/issues/86178), and
  [#85668](https://github.com/vercel/next.js/issues/85668), all reporting the
  identical `useContext` null crash during `/_global-error` prerendering
  since Next 16.0.0-canary builds. All three were auto-closed by GitHub's bot
  for "missing reproduction link," **not because they were fixed** — no
  maintainer response, no linked PR, no official workaround in any of them.
  One reporter (#85668) explicitly tried `force-dynamic`, `output:
  "standalone"`, `experimental.dynamicIO`, and removing hooks entirely — all
  failed for their case too. As of this writing, patching Next's build source
  is the only known way to unblock this; it isn't a shortcut taken instead of
  an easier fix that was missed.
- **If you're a second developer on this repo (not just future-me): read
  this before touching `next`, the `Dockerfile`, or your package manager.**
  This only matters for `next build` / Docker builds — `bun run dev` never
  triggers it, so you can work on Phase 4+ without ever thinking about this.
  It bites you only if:
  - **You use `npm`/`yarn`/`pnpm` instead of `bun`.** `patchedDependencies`
    (`package.json` + `bun.lock`) is a Bun-specific mechanism — a different
    package manager silently won't apply `patches/next@16.2.11.patch`, and
    the crash comes back the next time anyone runs `next build` or builds
    the Docker image. Use `bun` for installs on this repo, full stop.
  - **You run `bun add next@latest` / `bun update next`.** The patch is
    keyed to the exact string `next@16.2.11` in `patchedDependencies`. Any
    version bump breaks that key match and the patch silently stops
    applying. If you need to upgrade `next`: after upgrading, run `bun run
    build` — if it fails with this same `useContext`/`/_global-error`
    crash, first check whether it's fixed in your new version (try removing
    the patch entirely and rebuilding); if not, re-diff via `bun patch next`
    against the new `dist/build/index.js`/`dist/build/utils.js` (search for
    `UNDERSCORE_GLOBAL_ERROR_ROUTE`/`_global-error/page` — the exact line
    numbers will have shifted) and `bun patch --commit`.
  - **You refactor the `Dockerfile`'s `base` stage.** `patches/` must be
    `COPY`'d in *before* `RUN bun install` — it currently is
    (`COPY patches ./patches`, right after `COPY package.json bun.lock*`).
    Don't reorder this without keeping that constraint.
  - Do **not** "clean up" `src/app/global-error.tsx` or the `export const
    dynamic = "force-dynamic"` in `src/app/layout.tsx` thinking they're
    unrelated leftovers — both are load-bearing for this fix (the dynamic
    export fixes all 11 real routes; the patch fixes the one route that
    can't use it).
  3. `src/app/global-error.tsx` was added as an explicit (not auto-generated)
     implementation — this Next fork renamed the boundary's reset callback
     from `reset` to `unstable_retry` (see `AGENTS.md`'s warning about
     breaking API changes in this fork); it isn't the cause of the crash
     (reproduced with it present, absent, and minimal either way) but is
     still the semantically correct thing to have.
- **Also found + fixed while verifying the Docker build end-to-end** (`docker
  build --target web` + `docker compose --profile app up` smoke test against
  real infra, not just `next build`):
  - The `build` stage had no env at all, and `src/lib/env.ts`'s zod parse runs
    at module-eval time for every route Next collects page data for —
    `Dockerfile` now sets build-only placeholder env vars (`DATABASE_URL`,
    `REDIS_URL`, `PISTON_API_URL`, `APP_SECRET`) right before `RUN bun run
    build`; real values still only ever come from `env_file: .env` at
    container runtime, these are never read outside the build.
  - `docker-compose.yml`'s `web`/`worker` services now also force `NODE_ENV:
    "production"` in `environment:` (same pattern as the existing
    `DATABASE_URL`/`REDIS_URL`/`PISTON_API_URL` overrides) — without it,
    `.env`'s `NODE_ENV="development"` (correct for `bun run dev` on the host)
    silently overrode the image's baked-in `ENV NODE_ENV=production`, since
    `env_file`/`environment` always wins over an image's own `ENV`. Caught via
    the "non-standard NODE_ENV" warning in container logs, not a build
    failure — easy to miss.
  - Raw `docker run --env-file .env` (NOT `docker compose`) does **not** strip
    quotes from `.env` values the way Bun's dotenv loader or Compose's
    `env_file` parser do — `NODE_ENV="development"` becomes the literal
    8-character string `"development"` (quotes included), failing zod's enum
    check, and `SESSION_TTL_SECONDS="43200"` becomes `NaN` under
    `z.coerce.number()`. Purely an artifact of testing with raw `docker run`;
    the real deploy path (`docker compose`, and the VM's systemd unit which
    also calls `docker compose`) parses `.env` correctly. Don't debug env
    issues with `docker run --env-file` on this project — it lies.

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

## Phase 5 — Security & proctoring hardening

- **Strike policy**: every `ProctoringEventType` except `FOCUS_RETURN` counts
  as a strike toward the 2-strike auto-submit+lockout — `FOCUS_RETURN` is
  logged (for the timeline/audit trail) but is the "came back" companion
  event to `TAB_BLUR`/`VISIBILITY_HIDDEN`, not itself a violation. This
  wasn't spelled out in the schema/tasklist, it's a judgment call — see
  `isStrike()` in `src/lib/proctoring.ts`.
- **Event coalescing**: exiting fullscreen and switching tabs each fire more
  than one raw browser event for the same real action (`fullscreenchange`
  commonly also blurs the window; alt-tab fires both `visibilitychange` and
  `blur` near-simultaneously). Without suppression, one real "left the tab"
  action would burn 2 strikes and instant-lockout on the first switch. Fixed
  with an 800ms companion-suppression window in
  `src/components/participant/use-proctoring.ts` — `FULLSCREEN_EXIT` and
  `VISIBILITY_HIDDEN` set a suppress-until timestamp that the `blur` handler
  checks before reporting `TAB_BLUR`.
- **`finalizeSubmission` (`src/lib/participant-contests.ts`) now takes a 3rd
  reason, `"PROCTORING"`** (→ `ParticipantStatus.LOCKED_OUT`), plus an
  optional `reasonText` and an optional transaction-client 4th param. The
  client param exists because `recordProctoringEvent` in
  `src/lib/proctoring.ts` needs to call it from *inside* its own
  strike-counting transaction (read participant → count prior strikes →
  write event → maybe finalize, all atomically) — Prisma doesn't support
  nesting `prisma.$transaction` calls, so the transaction client has to be
  threaded through instead.
- **CSP**: went from a single-directive stub (`frame-ancestors 'none'` only)
  to a real policy in `src/proxy.ts`. The main constraint is
  `@monaco-editor/react`, which loads Monaco's JS/CSS/worker/font assets
  from `cdn.jsdelivr.net` by default (no self-hosting webpack plugin is
  wired up, and Next 16 defaults to Turbopack, which that plugin doesn't
  support) — so that host is allow-listed on `script-src`/`style-src`/
  `font-src`, and `worker-src` allows `blob:` for Monaco's web workers.
  `'unsafe-inline'` is still present on `script-src`/`style-src` (Next's App
  Router hydration/RSC inline scripts + Tailwind inline style attributes,
  no nonce plumbing exists to replace it) — **known gap**, a nonce-based
  strict CSP would need `next.config.ts` changes to thread a per-request
  nonce through, which felt out of scope for this pass. `connect-src 'self'`
  is enough for the SSE stream endpoint since it's same-origin.
- **Piston port exposure**: `docker-compose.yml` bound Piston's port as
  `2000:2000` (all interfaces), directly contradicting its own comment ("in
  production it must not be exposed publicly"). Piston executes arbitrary
  participant-submitted code, so this was a real gap, not just a lint nit.
  Changed to `127.0.0.1:2000:2000` — loopback-only. This doesn't break
  either dev mode (`bun run dev` on the host still reaches `localhost:2000`,
  which is what `.env.example`'s `PISTON_API_URL` already points at) or the
  `--profile app` containerized stack (`web`/`worker` reach it via the
  internal Docker network at `http://piston:2000`, never through the host
  port at all).
- **CSRF gap found**: `/api/auth/logout` was the one state-changing route
  without `requireCsrf` (every other POST/PATCH/DELETE route already had
  it, verified by grepping all `route.ts` files for the guard). Added it —
  low severity on its own (worst case is a forced logout), but worth closing
  since the checklist explicitly asked for CSRF to be "finalized."
- **AuditLog coverage**: verified every admin mutation route already calls
  `writeAudit` — no gaps found, nothing to change.
- Live-verified end-to-end via curl as `alice` against the "Verify Fixes"
  contest: `TAB_BLUR` → `WARNED`, `DEVTOOLS_ATTEMPT` → `AUTO_SUBMITTED` +
  `LOCKED_OUT`, further events after lockout are no-ops. Not visually
  tested in a browser (no browser available in this environment) — the
  fullscreen-request-on-start, the warning banner, keyboard-shortcut
  interception (F12/Ctrl+Shift+I/Ctrl+P etc.), and right-click/copy/paste
  interception should be checked manually.

## Phase 6 — Results, leaderboard, export, shortlist domain rules
- **Only final-state participants are ranked**: `getLeaderboard`
  (`src/lib/results.ts`) filters to `SUBMITTED`/`AUTO_SUBMITTED`/
  `LOCKED_OUT` before sorting — anyone still `INVITED`/`REGISTERED`/
  `IN_PROGRESS` simply doesn't appear on the leaderboard yet (not shown with
  a placeholder rank). Ranking itself reuses `compareForRanking`
  (`src/lib/scoring.ts`, previously written in Phase 2 but unused until
  now) rather than a new comparator — score desc, then submission time asc,
  then `tieBreakExecutionTimeMs` asc, nulls last.
- **Rank assignment is standard competition ranking** (ties share a rank,
  next distinct rank leaves a gap — e.g. 1, 1, 3): computed by hand in
  `getLeaderboard` via a rolling comparison against the previous sorted
  row, since `compareForRanking` only tells you ordering, not rank numbers.
- **Admin drill-down is intentionally unredacted**: `getParticipantDrilldown`
  reads `Attempt.testCaseResults` straight from the DB and does **not** call
  `redactHiddenResults` (the participant-facing redaction from Phase 4,
  `.../contests/[id]/route.ts`). This was an explicit user decision — admins
  need to see hidden test case actual/expected output to judge candidates,
  unlike participants who must never see it. If a future shared helper ever
  touches both codepaths, keep this asymmetry deliberate, not an oversight.
- **Shortlist only targets an existing contest's roster** — no inline
  "create contest and invite" flow (explicit user scope decision). It
  reuses `inviteParticipants()` (`src/lib/contests.ts`, factored out of the
  Phase 2 invite route so both routes share identical dedupe/validate
  semantics) and the same guards as direct invite: target must be
  `INVITE_ONLY` and not yet `isContestLocked` (see Phase 2 section — once a
  contest has any participant with `contestStartedAt` set, its roster is
  frozen, so shortlisting into an in-progress contest 409s).
- **XLSX uses the new `xlsx` (SheetJS) dependency** (`bun add xlsx`) —
  `src/lib/xlsx-results.ts`, one function (`buildResultsXlsx`) via
  `XLSX.utils.json_to_sheet` + `XLSX.write(wb, {type: "buffer",
  bookType: "xlsx"})`. CSV/PDF still use the existing hand-rolled `toCsv`
  and `pdf-lib`-based builder (`buildResultsPdf`, co-located in
  `pdf-credentials.ts` to reuse its private `fit()`/`wrap()`/page-layout
  helpers — mirrors `buildCredentialsPdf`'s structure exactly, just a
  different column set).
- **`NextResponse` body typing gotcha**: passing a `Buffer` directly as the
  response body (`new NextResponse(buf, ...)`) fails `tsc` — `Buffer` isn't
  assignable to `BodyInit` in this TS/lib version even though it's a
  `Uint8Array` at runtime. Fix is `new NextResponse(new Uint8Array(buf),
  ...)` (see `.../results/export/route.ts`'s xlsx branch). Watch for this
  in any future binary-export route.
- **UI**: `ContestDetailClient` was a flat stacked-Cards page before this
  phase; it's now wrapped in a `Tabs` (`Details | Questions & Roster |
  Results`) purely to make room for the new Results panel without a new
  route — `src/components/ui/tabs.tsx` existed since Phase 0's shadcn init
  but was unused anywhere until now. `ContestResultsPanel` +
  `ParticipantDrilldownDialog` + `ShortlistDialog`
  (`src/components/contests/`) follow the same select/export/
  `downloadBlob()` pattern already established in
  `participants-client.tsx` (Phase 1) rather than inventing a new one.
- Browser-tested via Playwright (`e2e/phase6-results.spec.ts`) — see the
  "Real-browser E2E pass" section below for what this surfaced.

## Real-browser E2E pass (Playwright, Phases 3–6) — bugs found and fixed

Phases 3–6 had only ever been curl/API-tested. A Playwright suite
(`e2e/phase{3,4,5,6}-*.spec.ts`, run via `bunx tsx e2e/<file>.spec.ts` — plain
`playwright` devDependency, no `@playwright/test` runner, hand-rolled
`step()`/`assert()`/`summarize()` helpers in `e2e/lib.ts`) drove all four
phases through a real Chromium browser and found real bugs beyond what curl
testing could ever catch:

- **RESOLVED: coding panel invisible in any real browser** —
  `src/components/ui/resizable.tsx`'s `ResizableHandle` (shadcn's stock
  template over `react-resizable-panels`) had its `aria-orientation` CSS
  variants inverted. Read the library's built JS directly and confirmed:
  `Group`'s `orientation` prop describes panel LAYOUT direction, but the
  `Separator` (handle)'s own `aria-orientation` attribute is computed as the
  OPPOSITE value — a horizontal (side-by-side) panel layout produces
  `aria-orientation="vertical"` on the handle (correctly describing the
  divider's own vertical visual line). shadcn's template assumed the other
  convention, so the handle rendered at `w-full`, collapsing BOTH the
  description panel and the Monaco editor to 0px width — the entire coding
  question UI was invisible in every real browser, not just Playwright, and
  no amount of curl testing would ever have caught it. Fixed by swapping the
  `aria-[orientation=vertical]:` selectors to `aria-[orientation=horizontal]:`
  in the component. Verified via a debug script: panel widths went from
  `{0, 0, 594}` to `{225, 368, 1}`.
- **RESOLVED: live Run/Submit results wiped to empty right when grading
  finishes** — `coding-question-panel.tsx`'s SSE `subscribe()` handler had a
  stale-closure bug in its `"final"` event branch:
  `setLiveResults(data.results ?? liveResults ?? [])`. The WORKER's own
  `"final"` pub/sub event (`src/lib/execution-events.ts`) never includes a
  `results` field by design (test cases stream incrementally via separate
  `"test-result"` events instead) — only the SSE route's own synthesized
  final event (sent when the attempt is already terminal at subscribe time)
  includes the full array from the DB. So on the live-grading path,
  `data.results` was always `undefined`, falling back to the closured
  `liveResults` variable — which was captured at the moment `subscribe()`
  was called, i.e. immediately after `setLiveResults([])` reset it, and
  never updates for the life of that `EventSource` (event listeners don't
  get fresh closures on re-render). Net effect: every Run/Submit's results
  got silently wiped to `[]` right as grading finished, unless the request
  happened to race ahead of the DB write (rare, which is why this was
  intermittent under curl-style testing and easy to miss). Fixed by only
  calling `setLiveResults(data.results)` when `data.results` is actually
  present, leaving the already-accumulated results untouched otherwise.
- **Test-only fixes** (no app bug, but worth remembering for future specs):
  - Login form's password field has no accessible label — use
    `page.locator("#password")`, not `getByLabel("Password")`.
  - shadcn's `CardTitle` renders a plain `<div>`, not a heading — use
    `getByText(...)`, not `getByRole("heading", ...)` for terminal-state
    banners like "Submitted" / "Contest ended — proctoring violation".
  - The participant dashboard's enabled row actions render as
    `<Button asChild><Link>` → an `<a role="link">`, not a `<button>`.
  - Typing into Monaco via `page.keyboard.type()` needs `delay: 40`+ — a
    5ms delay races Monaco's model update and autoClosing-bracket logic,
    dropping/transposing characters near auto-closed brackets.
  - Run and Submit share one rate-limit key (`exec:${user.id}`,
    `RATE_LIMIT_RUN_SUBMIT_SECONDS` = 5s default) — a test hitting Submit
    right after Run gets a legitimate 429; wait out the window instead of
    treating it as a bug.
  - **Simulating "fullscreen exit" for proctoring tests must call the real
    `document.exitFullscreen()`**, not `dispatchEvent(new
    Event("fullscreenchange"))`. Starting a contest auto-requests
    fullscreen (`contest-taking-client.tsx`), and headless Chromium
    actually grants it, so `document.fullscreenElement` is already set. The
    app's handler correctly guards on `if (document.fullscreenElement)
    return` — a synthetic event that doesn't change that state is
    correctly a no-op, not a bug.
  - The admin drilldown's coding test-case table renders the type column as
    plain `"Sample"`/`"Hidden"` (not `"Sample test"`/`"Hidden test"` — that
    fuller phrasing is only used in the participant-facing coding panel).
  - The participant answer-autosave PATCH route requires `markedForReview`
    (not optional in its zod schema) even though the e2e helper's TS type
    marked it optional — always pass it explicitly from test code.
  - The `/api/admin/contests/[id]/results/export` route is rate-limited to
    5 calls per 60s per admin. Repeated manual/debug script runs against
    the same seeded admin account can exhaust this budget right before a
    real test's own export step, producing a spurious `waitForEvent
    "download"` timeout that looks like a client bug but is just quota
    exhaustion — wait out the window (or check `redis-cli --scan --pattern
    "rl:*"` is empty) before concluding it's a real bug.
- **Stale worker/Redis connection after a Docker restart**: if
  `docker compose` restarts (containers show a low uptime relative to how
  long the worker process has been running), the long-lived `bun run
  worker` process's BullMQ consumer connection can end up stuck — jobs get
  queued (`executionQueue.add`) but never picked up, and Run/Submit hang
  until the SSE `waitFor` times out with no error anywhere. Not an app bug;
  restarting the worker process resolves it. Worth checking
  `docker ps --format "{{.Names}}\t{{.Status}}"` uptime vs. worker process
  age whenever Run/Submit inexplicably stalls with zero results.

## Coding: Run now grades hidden test cases too, shown as aggregate only (2026-07-22)

Per user request, `src/worker/index.ts` no longer filters test cases by
`AttemptType.RUN` (used to run only `isSample` cases) — Run and Submit both
now execute every test case. Run's score/maxPossibleScore are still never
persisted (kept `null`/`0` in the "final" event), only the *scope of
execution* changed, not scoring.

Participant-facing display (`coding-question-panel.tsx`) was changed to
match: sample test results still render one `ResultCard` each with full
diff/expected-output, but hidden/private results are no longer rendered as
individual "Hidden test" cards — they're collapsed into a single
`HiddenResultsSummary` line ("All N private test cases passed" / "Some
private test cases have failed"), with no diff or per-case detail ever
shown. This applies to both Run and Submit results in the participant view.

The **admin** drilldown (`participant-drilldown-dialog.tsx`) is a different,
unaffected component — it still legitimately shows full hidden test-case
detail (input/output) to admins, verified by `e2e/phase6-results.spec.ts`.

`e2e/phase4-coding.spec.ts` updated: the Run step now asserts the hidden
aggregate summary text appears and that zero "Hidden test" per-case cards
render (for both Run and Submit).
