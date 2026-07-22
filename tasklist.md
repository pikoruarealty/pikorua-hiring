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

## Phase 4 — Coding flow: Monaco + BullMQ + Piston + rate limiting
- [ ] Monaco (IntelliSense/autocomplete disabled)
- [ ] Per-question hard-lock timer (server-side)
- [ ] Run/Submit → BullMQ → worker → Piston; SSE status stream
- [ ] 1-per-5s rate limit; output caps + timeout-kill → TIME_LIMIT_EXCEEDED
- [ ] Checkpoint: Run live pass/fail, rate limit, hard-lock, graded Submit

## Phase 5 — Security & proctoring hardening
- [ ] Fullscreen + visibility/blur/focus + devtools/right-click/copy-paste/print
- [ ] Multi-monitor detection (best-effort)
- [ ] Proctoring ingestion: warn at 1, auto-submit+lockout at 2 (server-side)
- [ ] CSRF finalized; CSP tuned for Monaco/SSE; rate limits on login/export
- [ ] AuditLog coverage audit; Piston network isolation verified
- [ ] Checkpoint: two violations → auto-submit + lockout with full history

## Phase 6 — Results / leaderboard / shortlisting / export
- [ ] Leaderboard with tie-break (submission time, then execution time)
- [ ] Per-participant drill-down (code, test results, proctoring log)
- [ ] CSV/XLSX/PDF export
- [ ] Shortlist into new/existing contest
- [ ] Checkpoint: 3+ participant contest, tie broken correctly, shortlist

## Phase 7 — UI polish (shadcn, design-taste-frontend skill)
- [ ] Design tokens, responsive layouts, empty/loading/error states
- [ ] Polished countdown/palette/Monaco/leaderboard
- [ ] Checkpoint: full coherent product walkthrough
