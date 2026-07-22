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
