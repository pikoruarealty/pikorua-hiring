## Context / role
You are building a production-grade web platform, similar in spirit to TCS iON, AMCAT, HackerEarth for Recruiters, and HireVue-style assessment tools, that lets a company run timed MCQ / text-input and coding contests to shortlist interview candidates. Build this as a full Next.js (App Router) application with a real database, a real job queue, and a real code-execution sandbox — not a prototype. Ask me clarifying questions before writing code if anything below is ambiguous or if a decision materially changes the data model.

## Users & roles
- **Admin** — created only by another admin (or a seed script for the first admin). Multiple admins allowed. No public sign-up endpoint should exist anywhere in the app.
- **Participant** — account created by an admin (single or bulk CSV import). Receives credentials via email or a one-time setup link (specify which you implement).

## Core entities
Design the schema (Prisma + PostgreSQL) around these entities and relationships. Treat this as a starting point, not a final schema — flag any normalization issues you find.

- `User` (role: ADMIN | PARTICIPANT)
- `Contest` (type: MCQ_TEXT | CODING, start_time, end_time, duration_minutes, visibility: INVITE_ONLY | OPEN) — no participant cap (see resolved question 4 below).
- `ContestParticipant` (join table: contest_id, user_id, invited_at, status)
- `Question` (polymorphic: MCQ/text or Coding — see below)
- `Option` (for MCQ/text questions: label, score, is_text_answer)
- `CodingQuestionConfig` (per coding question: time_limit_seconds, memory_limit_mb, set by the admin per question — see Admin-Defined Limits section below)
- `TestCase` (for coding questions: input, expected_output, visibility: PUBLIC | PRIVATE, score)
- `Submission` (latest **Run** and latest **Submit** per participant per question — see Code Execution section)
- `ProctoringEvent` (contest_id, user_id, event_type, timestamp, metadata)
- `AuditLog` (admin actions: contest created, participant added, results exported, etc.)

### Resolved decisions (confirmed by product owner — implement exactly as stated)
1. **MCQ scoring model**: Partial credit — sum of scores of all selected options for a question, floored at 0.
2. **Text-input matching**: Case-insensitive, trimmed, single correct string.
3. **Coding score aggregation**: Partial scoring — sum of scores of passed test cases out of the question's total possible score.
4. **Max participants**: There is no cap on participants. Remove any participant-limit field/UI entirely; a contest is either invite-only (explicit list, no size limit) or open to all registered participants.
5. **Timezones**: All contest timing (start_time, end_time, per-question/coding time limits, timers) is handled **server-side**, in **IST (Asia/Kolkata)**. The server is the single source of truth for "is the contest open right now" and for countdown state — the client should treat any locally-computed timer as a *display estimate* only and resync from the server periodically (e.g., on each autosave/heartbeat), so a candidate can't extend their time by changing their system clock.
6. **Result ties / ranking**: Ties are broken first by submission time (earlier wins), then by code execution time (faster wins) for coding questions.

## MCQ / Text-Input Contest Behavior
- One shared duration/timer for the whole contest (not per-question).
- Per-question actions: **Save & Next**, **Mark for Review & Next**, **Clear Response**, **Skip**. (Note: I added "Clear Response" — standard in this UI pattern; confirm if you want it.)
- Free navigation between questions via a question palette showing status per question: Not Visited / Not Answered / Answered / Marked for Review / Answered & Marked for Review.
- Autosave every response to the server (debounced) so a browser crash doesn't lose progress.

## Coding Contest Behavior
- **Admin-defined per-question limits**: for every coding question, the admin sets a `time_limit_seconds` and `memory_limit_mb` when authoring the question. These are the limits enforced by Piston during execution (not a platform-wide default) — surface them in the admin question-editor form, validate sane ranges (e.g., time 1–15s, memory 16–512MB, confirm ranges if you disagree), and pass them through to every Run and Submit call for that question.
- Each coding question's contest-facing time limit within the overall contest window (clarify: is this a *soft* recommended time or a *hard* per-question timer that locks the question when it expires? Default to **hard lock**, enforced server-side in IST per the timing rules above). Note this is distinct from the execution `time_limit_seconds` above — one is "how long the candidate may spend on this question," the other is "how long the candidate's program may run per test case." Use separate fields for these; don't conflate them.
- Codeforces/HackerRank style: candidate reads stdin, writes to stdout — no predefined function signatures or boilerplate scaffolding beyond an optional stdin/stdout template comment.
- **Run**: executes against public test cases only, shows pass/fail + actual vs expected output. Only the latest Run result is persisted (overwrite previous).
- **Submit**: executes against all test cases (public + private), computes score. Only the latest Submission is persisted (overwrite previous), storing source code, language, per-test-case results, and score. Confirm: should Submit be allowed multiple times with the last one counting, or is it a one-shot final submission? Default to **allowed multiple times, last one before the contest/question deadline counts**.
- Rate limit Run/Submit per user (e.g., 1 execution per 5 seconds, configurable), enforced server-side, not just client-side.
- Execution pipeline: API route enqueues a job to **BullMQ** (Redis-backed) → worker sends the job to a **self-hosted Piston** instance → worker writes results back to Postgres → client polls or subscribes (WebSocket/SSE) for status.
- Supported languages: C, C++, Java, Python — map these to Piston's runtime identifiers explicitly in your language config.
- Sanitize all stdin/stdout/source-code rendering on the client (escape HTML) to prevent stored XSS when displaying candidate code or output back to admins/candidates.
- Monaco editor: disable IntelliSense, autocomplete suggestions, quick-suggestions, and parameter hints. Provide the exact Monaco config options for this (`quickSuggestions: false`, `suggestOnTriggerCharacters: false`, `parameterHints.enabled: false`, `wordBasedSuggestions: false`, etc.) rather than leaving it implied.

## Auth — handled manually, no third-party auth library
- Do not use NextAuth/Auth.js or any other auth-as-a-library. Implement auth yourself: password hashing (bcrypt/argon2), session tokens (signed, httpOnly, secure cookies) or JWTs stored server-side per session, login/logout routes, and middleware-based route protection. State your exact approach (cookie-session vs JWT) before implementing, since it affects how single-active-session enforcement works.
- No self-registration route, anywhere, ever — enforce this at the routing layer too, not just by hiding a UI link.
- Single active session per participant: on new login, invalidate the previous session (e.g., store a `session_version` or `current_session_id` on the user row and check it on every request; a new login increments/replaces it so the old session fails validation). Admins can have normal multi-session behavior unless you tell me otherwise.

## Bulk account creation (Admin)
- Admin can create participant accounts in bulk by uploading a list of email addresses (CSV upload or newline/comma-separated paste — support both if reasonable).
- For each email, generate a strong random password server-side (specify your generation scheme: length, character set) and create the account with that password already hashed and stored — never store or log the plaintext password anywhere except in the one-time export described below.
- After bulk creation, the admin must be able to retrieve the generated credentials exactly once via:
  - **CSV export** (email, password, and any other relevant columns), and
  - **PDF export** (a formatted, printable list — e.g., one row per candidate with email/password, suitable for handing out or emailing individually).
- Treat this credential export as sensitive: gate it behind admin auth, and note in your response whether you regenerate/invalidate the password after it's viewed once, or whether it remains valid until the candidate changes it (state your default and I'll confirm).
- Duplicate emails in a bulk upload should be detected and reported back to the admin (skipped, not silently overwritten) rather than erroring out the whole batch.

## Security & Proctoring Requirements

This is a candidate-shortlisting platform handling credentials, source code, and assessment integrity data — treat security as a first-class requirement in every phase of the plan above, not a bolt-on in Phase 5. Address each of the following explicitly in your response.

### Application security
- **Password & credential handling**: hash with argon2id or bcrypt (cost factor stated explicitly); never log, cache, or return plaintext passwords anywhere except the one-time bulk-credential export; enforce a minimum complexity for admin-set passwords and for the random passwords generated in bulk creation.
- **Session security**: httpOnly, secure, SameSite=strict (or Lax if a cross-site redirect flow requires it — justify) cookies; short-lived session tokens with server-side revocation (needed anyway for single-active-session enforcement); CSRF protection on all state-changing routes.
- **Authorization**: every API route must check role (admin vs participant) and resource ownership (a participant can only read/write their own submissions, an admin can only manage contests they're permitted to) server-side — never rely on the client hiding a button. Write this as middleware/guards applied consistently, not per-route ad hoc checks.
- **Input validation & sanitization**: validate and type-check every request body/query param server-side (e.g., zod schemas) before it touches the database or Piston. Sanitize/escape all user-supplied content before rendering — question text, candidate names, submitted source code, program stdout/stderr — since all of these are attacker-controlled strings that get displayed back to admins or other views (stored XSS risk).
- **Injection protection**: Prisma parameterizes queries by default — confirm no raw SQL string concatenation is introduced anywhere; validate file uploads (bulk-email CSV) for type/size/row limits before parsing.
- **Rate limiting**: server-side rate limits on login attempts (to block credential-stuffing/brute-force against candidate accounts), on Run/Submit code execution, and on any bulk-export endpoint — not just the code-execution limit already specified.
- **Secrets management**: DB credentials, session signing keys, Piston endpoint, Redis URL, etc. via environment variables, never committed; state how local dev vs production config is separated.
- **Security headers**: CSP, X-Frame-Options/frame-ancestors (contests should not be embeddable in an iframe, which could be used to defeat fullscreen/proctoring checks), X-Content-Type-Options, Strict-Transport-Security.
- **Audit logging**: every admin action that changes state (account created, contest published, question edited, results exported, participant added/removed) is written to `AuditLog` with admin id, timestamp, and a diff/summary of the change — this is separate from `ProctoringEvent` and should never be deletable through the app UI.
- **Dependency hygiene**: state your approach to keeping the Monaco/Next.js/Piston stack patched (e.g., renovate/dependabot), since a candidate-facing code editor and a self-hosted execution engine are both plausible attack surfaces.

### Code execution sandbox security
- Piston already sandboxes execution, but state explicitly how you configure it for this use case: per-request time and memory limits taken from the admin-set `CodingQuestionConfig` (not hardcoded), no network access from inside the sandbox, output size caps (to stop a candidate from intentionally exhausting disk/response size with an infinite-print program), and how you handle a runaway process (kill on timeout, surface a clean "time limit exceeded" result rather than a raw error).
- The execution worker (BullMQ consumer) should be a separate process/container from the web app, so a compromised or misbehaving execution job can't reach the main app's filesystem or environment.

### Proctoring
Real browser-based proctoring (disallowing devtools, right-click, copy-paste, forcing fullscreen, detecting tab/window switches) can only ever be a **best-effort deterrent**, not a hard security guarantee. A determined candidate can bypass any of these client-side checks (browser extensions, secondary devices, OS-level screenshot tools, virtual machines). Platforms like TCS iON achieve real lockdown by shipping a **custom kiosk OS or locked-down desktop client**, not by relying on JavaScript in a normal browser tab. Given the stated implementation requirement is Next.js (a web app, not a native kiosk client), be explicit in your response about this ceiling, and implement the following as **detection-and-logging**, not prevention claims:
- Fullscreen API on contest start; if the candidate exits fullscreen, log a `ProctoringEvent` and prompt to re-enter.
- `visibilitychange` / `blur` / `focus` listeners to detect tab switches, window switches, and loss of window focus; log each occurrence with type and duration.
- Disable right-click context menu and common devtools shortcuts (F12, Ctrl+Shift+I, Ctrl+U, Ctrl+S, etc.) as a deterrent; note in your response that devtools can still be opened via the browser menu or external tools, so this is a friction layer, not a control.
- Block copy/paste in the code editor and question text via event listeners; note this only stops accidental/casual copying, not a technically motivated candidate.
- Block the browser's print/save-as shortcuts on the contest page for the same reason.
- Detect (and log, not necessarily block) multiple-monitor setups where feasible via the Window Management / Screen APIs, since it's a common cheating vector recruiters ask about — state clearly if browser API support makes this unreliable.
- **Violation policy**: 1st violation of any monitored type → on-screen warning + logged event, timer/answers unaffected. 2nd violation (any type, cumulative — not per-type) → auto-submit the contest immediately, log the event with timestamp, IP, user agent, and violation history on the server, and lock the candidate out of that contest.
- Every `ProctoringEvent` is written server-side the moment it happens (not batched/buffered client-side until contest end), so a crashed tab or killed process doesn't lose the log; expose this per-candidate as an audit trail on the admin results view, not just a pass/fail flag.
- IP-consistency checks per session (flagging if a session's requests suddenly come from a different IP mid-contest) are out of scope by default — flag if you think it's cheap to add given the session model you choose.
- If you want camera/screenshot-based proctoring like TCS iON's AI proctoring (face verification, gaze tracking), say so explicitly — it's a significant scope and infra addition (media capture, storage, and likely a third-party proctoring API) not implied by anything else in this brief, and I have not asked for it. **Do not implement camera/microphone capture unless I confirm I want it.**

## Admin capabilities
- Create participant accounts individually or in bulk from a list of emails (see Bulk Account Creation section).
- Create contests → add questions (from a reusable question bank, or ad hoc — confirm which) → set participant list (explicit invite list or "open to all registered users", no size limit) → publish.
- View all results: per-contest leaderboard, per-question breakdown, proctoring violation log per candidate.
- Shortlist candidates from one contest's results into a new contest's participant list (bulk action).
- Export results to XLSX and CSV.

## Participant capabilities
- Dashboard listing upcoming/active/past contests they're invited to.
- Enter a contest only within its start/end window; blocked otherwise with a clear reason (not started / already ended / not invited).
- Collapsible on-screen calculator and scratch pad available throughout the contest, persisted per-session (confirm: should scratch pad content be saved server-side for admin review, e.g., to detect planning of cheating, or is it just a local convenience the candidate can discard?).

## Implementation stack (confirm/fill gaps)
- Next.js (App Router) full stack, TypeScript.
- PostgreSQL via Prisma.
- Redis + BullMQ for the code-execution queue.
- Self-hosted **Piston** (engineer-man) as the execution engine — specify docker-compose setup for local dev.
- Monaco editor with IntelliSense/autocomplete disabled as above.
- **Auth is hand-rolled** (see Auth section) — no NextAuth/Auth.js/Clerk/etc.
- **UI**: shadcn/ui components on top of Tailwind CSS, with a modern, clean visual style (proper spacing, dark/light mode if reasonable, accessible focus states, consistent design tokens) — not raw unstyled HTML. Use shadcn's Dialog, Table, Form, Tabs, Card, Badge, etc. where they fit naturally (e.g., question palette as a grid of Badge/Button states, results as a DataTable, contest creation as a multi-step Form).
- Real-time updates for run/submit status and proctoring alerts: WebSocket (e.g., via a small Socket.IO/ws server alongside Next.js) or Server-Sent Events — pick one and justify it.

## Deliverable expectations
1. Data model (Prisma schema) with the resolved decisions above reflected directly in field names/types/comments.
2. High-level architecture diagram/description (web app, queue, workers, Piston, DB, Redis).
3. API route list with method, path, purpose, and auth requirements.
4. **A detailed, phase-wise implementation plan** — this is a required deliverable in its own right, not just a build order. For each phase, specify: the goal of the phase, the exact features/screens/API routes delivered, the database migrations involved, what's explicitly out of scope for that phase (deferred to a later one), and what a working demo/checkpoint looks like at the end of the phase (i.e., what I should be able to click through and verify before you move on). Suggested phase breakdown (adjust as needed, but keep it this granular):
   - Phase 0: Project scaffolding, Prisma schema, Docker Compose (Postgres, Redis, Piston), hand-rolled auth (login/logout/session), admin seed script.
   - Phase 1: Admin — manual and bulk participant account creation, CSV/PDF credential export, participant management UI.
   - Phase 2: Admin — contest CRUD, question bank, MCQ/text question authoring, coding question authoring (incl. time/memory limits and test cases).
   - Phase 3: Participant — contest dashboard, MCQ/text-input contest-taking flow (palette, save/mark/skip, autosave, server-side IST timer).
   - Phase 4: Coding contest flow — Monaco integration, Run/Submit wired to BullMQ + Piston, per-question execution limits enforced, rate limiting.
   - Phase 5: Security & proctoring — fullscreen/visibility/devtools/copy-paste detection and logging, warning-then-autosubmit policy, admin-side violation audit trail, plus an application-security pass (rate limiting on auth/export endpoints, security headers, CSRF, audit logging) per the Security & Proctoring Requirements section.
   - Phase 6: Results — scoring/aggregation (partial credit, tie-breaking by submission time then execution time), leaderboards, shortlisting into new contests, XLSX/CSV export.
   - Phase 7: UI polish pass with shadcn/ui — consistent design tokens, responsive layout, empty/loading/error states across all screens built in earlier phases. Use /design-frontend-taste skill
   Reorder or split phases if you think a different sequencing reduces risk, but explain why.
5. Explicit call-outs anywhere you had to make an assumption, so I can correct it before you build on top of it.

Present the phase-wise implementation plan first, as a standalone section I can review and approve, before generating schema or code — do not start writing implementation code until the plan is presented. Also maintain the following files: progress.md, tasklist.md, memory.md
