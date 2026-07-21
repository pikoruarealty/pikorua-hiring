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
- [ ] Question bank CRUD (MCQ per-option scores / TEXT / CODING config+testcases)
- [ ] Contest CRUD + attach questions via ContestQuestion (reorder, overrides)
- [ ] Visibility (INVITE_ONLY roster / OPEN) + publish flow
- [ ] Scoring pure functions + unit tests
- [ ] Checkpoint: author questions, assemble + publish a contest

## Phase 3 — Participant MCQ/TEXT contest-taking flow
- [ ] Register/start with server-authoritative IST countdown
- [ ] Question palette + Save/Mark/Clear/Skip + debounced autosave
- [ ] Final submit (manual + timeout auto-submit) + scoring
- [ ] Checkpoint: take a full MCQ+TEXT contest, autosave survives refresh

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
