# Task list

Granular checklist tracking the approved phase plan. `[x]` done, `[ ]` pending.

## Phase 0 — Scaffolding, schema, auth, infra
- [x] Scaffold Next.js 16 (App Router, TS strict, Tailwind 4) with bun
- [x] Init shadcn/ui (radix base) + add Card/Input/Label/Button/Sonner
- [x] Prisma 7 schema (User, Session, Contest, ContestParticipant, Question,
      Option, TextAnswerConfig, CodingQuestionConfig, TestCase, ContestQuestion,
      Attempt, ProctoringEvent, AuditLog) + enums
- [x] Initial migration + coding-limit CHECK-constraint migration
- [x] pg driver adapter wired (Prisma 7 requires it)
- [x] docker-compose (postgres/redis/piston + app-profile web/worker) + Dockerfile
- [x] `.env` / `.env.example` + zod env validation
- [x] argon2id password hashing + generation + complexity
- [x] Session module (opaque token, hashed at rest, sessionVersion enforcement)
- [x] CSRF (signed double-submit, session-bound)
- [x] Route guards (requireUser/requireAdmin/requireCsrf) + cookies helper
- [x] Redis-backed rate limiter
- [x] Auth routes: login / logout / me / change-password
- [x] proxy.ts security headers + coarse route protection
- [x] Login page + admin/participant dashboards + shared header/logout
- [x] BullMQ queue module + worker stub
- [x] Seed script (admin + 2 participants + sample MCQ/TEXT/CODING questions)
- [x] Phase 0 checkpoint verified (auth flow, single-session, CSRF, build)
- [x] progress.md / tasklist.md / memory.md

## Phase 1 — Admin participant management + bulk import/export
- [x] Participant list/search/create/edit UI + `/api/admin/participants*` routes
- [x] CSV bulk import with per-row validation report (dupes skipped + reported)
- [x] Credential CSV export (AuditLog'd)
- [x] Credential PDF export (AuditLog'd, pdf-lib)
- [x] Rate limit + audit on export endpoints (5/min/admin)
- [x] Delete guard (409 if contest history) + deactivate bumps sessionVersion
- [x] Checkpoint: import 23→21 created/2 skipped, export PDF, login as one, single-session ✅

## Phase 2 — Admin contest & question-bank CRUD
- [x] Question bank CRUD (MCQ per-option scores / TEXT / CODING config+testcases)
- [x] Contest CRUD + attach questions via ContestQuestion (reorder, overrides)
- [x] Visibility (INVITE_ONLY roster / OPEN) + publish flow
- [x] Scoring pure functions (`src/lib/scoring.ts`; no test runner configured
      yet, so verified via manual smoke script rather than a unit-test file —
      flag if you want vitest/node:test added)
- [x] Checkpoint: author questions (MCQ/TEXT/CODING), assemble + publish a
      contest, publish/lock/delete guards all verified via curl E2E ✅
- [x] RESOLVED (during Phase 3 deploy-pipeline work, root cause was actually a
      genuine Next.js core bug, not `next-themes` as originally suspected):
      `bun run build`/Docker build failing prerendering `/_global-error` — see
      `memory.md` "RESOLVED" section for the full investigation, the
      `export const dynamic = "force-dynamic"` fix on the root layout, and the
      `bun patch`-based Next.js patch (`patches/next@16.2.11.patch`) needed
      for the one route that can't opt out of the broken path any other way.
- [x] Post-checkpoint fix: `isContestLocked` was wall-clock-based
      (`now >= startAt`), which permanently bricked any contest whose start
      time passed with nobody in it (couldn't add questions/roster — no
      recovery). Changed to activity-based (locked only once a
      `ContestParticipant.contestStartedAt` exists) — see `memory.md`.
- [x] UI polish: fixed a real Dialog width-override bug (base `sm:max-w-sm`
      losing the breakpoint fight against unprefixed overrides), and Select
      dropdowns defaulting to Radix's `item-aligned` position instead of the
      standard `popper` (below-trigger) — both fixed at the `ui/` component
      level. Question editor redesigned with Details/Content tabs.

## Phase 3 — Participant MCQ/TEXT contest-taking flow
- [x] Attempt.visited/markedForReview schema fields + migration
- [x] Register/start with server-authoritative countdown (`effectiveDeadline`)
- [x] Question palette (5-state) + Save/Mark/Clear/Skip + autosave (MCQ:
      instant on toggle, TEXT: 600ms debounced)
- [x] Final submit (manual + server-detected timeout via `ensureNotExpired`,
      called from every read/write route, not a cron job) + synchronous
      MCQ/TEXT scoring
- [x] Safe participant-facing question projection (no scores/correct
      answers/solutions leaked)
- [x] Checkpoint: full MCQ+TEXT run, autosave survives simulated refresh,
      submit locks further edits, backdated-start timeout auto-submits
      server-side with zero client submit call ✅
- [x] Post-checkpoint: fixed `isContestLocked` (was wall-clock-based,
      bricked past-start empty contests — see Phase 2 tasklist entry) and two
      real shadcn component bugs (Dialog width override, Select popper
      position) reported during manual testing
- [x] Verified in a real browser via Playwright (`e2e/phase3-taking.spec.ts`,
      11/11 steps): checkbox MCQ answers with instant autosave, debounced
      TEXT autosave, palette navigation preserving answers, reload persisting
      server-saved state, the submit-confirmation dialog, and the post-submit
      dashboard "Submitted" state blocking re-entry.

## Phase 4 — Coding flow: Monaco + BullMQ + Piston + rate limiting
- [x] Monaco (IntelliSense/autocomplete disabled) — `CodeEditor` in
      `src/components/participant/monaco-editor.tsx`
- [x] Per-question hard-lock timer (server-side) — new `Attempt.questionStartedAt`
      field, started via `POST .../visit`, resolved from
      `ContestQuestion.hardLockSecondsOverride ?? CodingQuestionConfig.defaultHardLockSeconds`
- [x] Run/Submit → BullMQ → worker → Piston; SSE status stream — real worker
      in `src/worker/index.ts`, Redis pub/sub relayed over SSE at
      `.../questions/[cqId]/stream`
- [x] 1-per-5s rate limit; output caps + timeout-kill → TIME_LIMIT_EXCEEDED
- [x] Checkpoint: Run live pass/fail, rate limit, hard-lock, graded Submit —
      all verified via curl E2E against a fixture contest (see `memory.md`
      for the two Piston config gotchas hit along the way)
- [x] Post-checkpoint: fixed 5 bugs found during manual testing — SSE stream
      TDZ crash (`heartbeat` used before declared, silently broke Run's live
      feedback), admin contest builder scrolling to top on every save
      (full-page reload state was remounting the whole tree), seed
      `starterCode` for the sample coding question being the actual solution
      instead of a stub, and sample test cases never being exposed to
      participants at all (added end-to-end). Confirmed sample result
      persistence during editing was already correct. Admin-side visibility
      into coding results deferred to a future phase per direct instruction
      — see `memory.md`
- [x] Verified in a real browser via Playwright (`e2e/phase4-coding.spec.ts`,
      7/7 steps): typed a correct Python solution into the actual Monaco
      editor, watched live SSE-streamed sample-test results render on Run,
      graded hidden tests on Submit, and confirmed the hard-lock countdown
      disables Run/Submit once it expires. Surfaced and fixed two real,
      production-affecting bugs along the way — see `memory.md`
      ("RESOLVED: coding panel invisible" and "RESOLVED: live Run/Submit
      results wiped on final SSE event").

## Phase 5 — Security & proctoring hardening
- [x] Fullscreen + visibility/blur/focus + devtools/right-click/copy-paste/print
      — `src/components/participant/use-proctoring.ts`, wired into
      `contest-taking-client.tsx` while a contest is IN_PROGRESS. Fullscreen
      is requested (best-effort, needs the Start-button user gesture) on
      contest start.
- [x] Multi-monitor detection (best-effort) — one-shot `window.screen.isExtended`
      check (Window Management API, Chromium-only) on mount, reported as
      `MULTI_MONITOR_DETECTED` if true.
- [x] Proctoring ingestion: warn at 1, auto-submit+lockout at 2 (server-side)
      — `src/lib/proctoring.ts` (`recordProctoringEvent`, transactional
      strike-counting) + `POST .../contests/[id]/proctoring-events`.
      `finalizeSubmission` (`src/lib/participant-contests.ts`) extended with
      a `"PROCTORING"` reason → `ParticipantStatus.LOCKED_OUT`, and an
      optional transaction-client param so it can run inside proctoring's
      own transaction (nested `prisma.$transaction` isn't supported).
      `FOCUS_RETURN` is logged but never a strike (it's the "came back"
      companion event); fullscreen-exit/blur/visibility-hidden are coalesced
      (800ms suppression window) since exiting fullscreen or switching tabs
      fires more than one browser event for the same real action.
- [x] CSRF finalized (added to `/api/auth/logout`, the one state-changing
      route that was missing it — every other POST/PATCH/DELETE route
      already had it); CSP tuned in `src/proxy.ts` for Monaco (CDN
      script/style/font/worker sources — see file comment for the
      `'unsafe-inline'` tradeoff) and SSE (`connect-src 'self'` covers same-
      origin fetch/EventSource); rate limits on login/export were already in
      place from earlier phases, verified still correct; new proctoring
      ingestion endpoint rate-limited (20/10s/participant, fails open —
      dropping an occasional event is fine, a hard 429 would let spamming
      dodge the very trigger meant to catch them).
- [x] AuditLog coverage audit — every admin mutation route already calls
      `writeAudit` (verified via grep, no gaps found). Piston network
      isolation verified: `docker-compose.yml`'s piston port mapping was
      `2000:2000` (all interfaces) despite its own comment saying it must
      not be exposed publicly — changed to `127.0.0.1:2000:2000` (loopback
      only, so `bun run dev` on the host still reaches it, but it's not
      reachable from outside the host in either dev or the `--profile app`
      container stack, which talks to it over the internal Docker network
      regardless).
- [x] Checkpoint: live-tested via curl as `alice` against the throwaway
      "Verify Fixes" contest — `TAB_BLUR` → `{"action":"WARNED"}`, then
      `DEVTOOLS_ATTEMPT` → `{"action":"AUTO_SUBMITTED","status":"LOCKED_OUT"}`,
      then a third event confirmed idempotent (`"action":"NONE"`, status
      stays `LOCKED_OUT`). `bunx tsc --noEmit` and `bun run lint` both clean.
- [x] Verified in a real browser via Playwright (`e2e/phase5-proctoring.spec.ts`,
      5/5 steps): a genuine `document.exitFullscreen()` (not a synthetic
      event — see `memory.md`) triggers the strike-1 warning banner with the
      exact copy, an F12 keypress after the companion-suppression window
      triggers strike-2 auto-submit + the "Contest ended — proctoring
      violation" screen, and the admin leaderboard reflects `LOCKED_OUT`.

## Phase 6 — Results / leaderboard / shortlisting / export
- [x] Leaderboard with tie-break (submission time, then execution time) —
      `getLeaderboard` in `src/lib/results.ts` reuses the existing
      `compareForRanking` (`scoring.ts`) instead of reimplementing it;
      standard competition ranking (ties share a rank, gaps before the next
      distinct rank). Only `SUBMITTED`/`AUTO_SUBMITTED`/`LOCKED_OUT`
      participants are ranked.
- [x] Per-participant drill-down (code, test results, proctoring log) —
      `getParticipantDrilldown`, admin-only route, deliberately does **not**
      call the participant-facing `redactHiddenResults` — hidden test case
      actual output is shown in full, per direct instruction.
- [x] CSV/XLSX/PDF export — CSV reuses `toCsv`, PDF reuses `pdf-lib` (new
      `buildResultsPdf` co-located in `pdf-credentials.ts` to share its
      private layout helpers), XLSX uses the new `xlsx` (SheetJS) dependency
      (`src/lib/xlsx-results.ts`). Same selected/all scope + rate-limit +
      audit pattern as the Phase 1 credentials export.
- [x] Shortlist into new/existing contest — targets an **existing**
      invite-only contest only (no inline contest creation, per direct
      instruction). Roster-insertion logic factored out of the participants
      invite route into a shared `inviteParticipants()` helper
      (`src/lib/contests.ts`) so direct-invite and shortlist share identical
      dedupe semantics.
- [x] UI: new "Results" tab in `ContestDetailClient` (added a `Tabs` wrapper
      — `Details | Questions & Roster | Results` — around the previously
      flat page); `ContestResultsPanel` + `ParticipantDrilldownDialog` +
      `ShortlistDialog` follow the existing `participants-client.tsx`
      select/export/`downloadBlob()` conventions.
- [x] `bunx tsc --noEmit`, `bun run lint` (0 errors — pre-existing warnings
      in unrelated files untouched), and `bun run build` all clean.
- [x] Checkpoint: 3+ participant contest, tie broken correctly, shortlist —
      verified in a real browser via Playwright (`e2e/phase6-results.spec.ts`,
      9/9 steps). Tie-break nuance: `compareForRanking` only treats rows as a
      literal tie if score AND submittedAt-to-the-millisecond AND
      tieBreakExecutionTimeMs all match exactly, which is unreachable via
      independently driven participant sessions. The test instead drives 3
      participants to an equal `totalScore` by answering identically, then
      asserts they're ranked in the correct relative order by earliest
      `submittedAt` (the real tie-break rule) rather than asserting a shared
      literal rank number. Also verified: the admin leaderboard visually
      shows the 3 tied rows in submission order, all three export formats
      (CSV/XLSX/PDF) trigger real browser downloads with correct filenames,
      shortlisting a selected participant lands them as `INVITED` on the
      target contest's roster, and the participant drilldown shows
      hidden-test-case output (actual output + `print(a + b)` source) for a
      coding submission.

## Phase 7 — UI polish (shadcn, design-taste-frontend skill)
- [ ] Design tokens, responsive layouts, empty/loading/error states
- [ ] Polished countdown/palette/Monaco/leaderboard
- [ ] Checkpoint: full coherent product walkthrough
