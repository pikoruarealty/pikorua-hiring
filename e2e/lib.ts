import { request, type APIRequestContext, type BrowserContext } from "playwright";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export const CREDENTIALS = {
  admin: { username: "admin", password: "Admin@12345" },
  alice: { username: "alice", password: "Alice@12345" },
  bob: { username: "bob", password: "Bobby@12345" },
} as const;

/** Reads the readable contest_csrf cookie from a Playwright request/browser context. */
export async function csrfHeaders(
  ctx: APIRequestContext | BrowserContext,
): Promise<Record<string, string>> {
  const state = await ctx.storageState();
  const cookie = state.cookies.find((c) => c.name === "contest_csrf");
  if (!cookie) throw new Error("No contest_csrf cookie found — did you log in first?");
  return { "x-csrf-token": cookie.value };
}

export async function newApiContext(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: BASE_URL });
}

export async function login(
  ctx: APIRequestContext | BrowserContext,
  username: string,
  password: string,
): Promise<"ADMIN" | "PARTICIPANT"> {
  const req = "request" in ctx ? ctx.request : ctx;
  const res = await req.post(`${BASE_URL}/api/auth/login`, {
    data: { username, password },
  });
  if (!res.ok()) {
    throw new Error(`Login failed for ${username}: ${res.status()} ${await res.text()}`);
  }
  const body = await res.json();
  return body.role;
}

async function post(ctx: APIRequestContext | BrowserContext, url: string, data?: unknown) {
  const req = "request" in ctx ? ctx.request : ctx;
  const headers = await csrfHeaders(ctx);
  const res = await req.post(`${BASE_URL}${url}`, { data, headers });
  if (!res.ok()) {
    throw new Error(`POST ${url} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function patch(ctx: APIRequestContext | BrowserContext, url: string, data?: unknown) {
  const req = "request" in ctx ? ctx.request : ctx;
  const headers = await csrfHeaders(ctx);
  const res = await req.patch(`${BASE_URL}${url}`, { data, headers });
  if (!res.ok()) {
    throw new Error(`PATCH ${url} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

async function get(ctx: APIRequestContext | BrowserContext, url: string) {
  const req = "request" in ctx ? ctx.request : ctx;
  const res = await req.get(`${BASE_URL}${url}`);
  if (!res.ok()) {
    throw new Error(`GET ${url} failed: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Always creates a fresh participant with a unique, timestamped username so
 * the plaintext password (returned only once, at creation) is always known
 * to the test — there is no credential-reset endpoint to recover it for a
 * pre-existing user across re-runs.
 */
export async function createParticipant(
  adminCtx: APIRequestContext | BrowserContext,
  label: string,
): Promise<{ id: string; username: string; password: string }> {
  const username = `e2e_${label}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const body = await post(adminCtx, "/api/admin/participants", {
    username,
    fullName: label,
    email: `${username}@e2e.test`,
  });
  return { ...body.participant, password: body.credential.password };
}

export interface CreateContestOpts {
  title: string;
  visibility?: "INVITE_ONLY" | "OPEN";
  startAt?: Date;
  endAt?: Date;
  durationMinutes?: number;
  resultsVisibleToParticipants?: boolean;
}

export async function createContest(
  adminCtx: APIRequestContext | BrowserContext,
  opts: CreateContestOpts,
): Promise<{ id: string; title: string; status: string }> {
  const now = Date.now();
  const startAt = opts.startAt ?? new Date(now - 60_000);
  const endAt = opts.endAt ?? new Date(now + 3 * 3600_000);
  const body = await post(adminCtx, "/api/admin/contests", {
    title: opts.title,
    visibility: opts.visibility ?? "INVITE_ONLY",
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    durationMinutes: opts.durationMinutes ?? 60,
    resultsVisibleToParticipants: opts.resultsVisibleToParticipants ?? true,
  });
  return body.contest;
}

export async function attachQuestion(
  adminCtx: APIRequestContext | BrowserContext,
  contestId: string,
  questionId: string,
  opts?: { pointsOverride?: number; hardLockSecondsOverride?: number; sectionLabel?: string },
): Promise<string> {
  const body = await post(adminCtx, `/api/admin/contests/${contestId}/questions`, {
    questionId,
    ...opts,
  });
  return body.id;
}

export async function inviteRoster(
  adminCtx: APIRequestContext | BrowserContext,
  contestId: string,
  userIds: string[],
): Promise<void> {
  await post(adminCtx, `/api/admin/contests/${contestId}/participants`, { userIds });
}

export async function publishContest(
  adminCtx: APIRequestContext | BrowserContext,
  contestId: string,
): Promise<void> {
  await post(adminCtx, `/api/admin/contests/${contestId}/publish`);
}

export async function listQuestions(
  adminCtx: APIRequestContext | BrowserContext,
): Promise<Array<{ id: string; type: string; title: string }>> {
  const body = await get(adminCtx, "/api/admin/questions?pageSize=100");
  return body.questions;
}

export async function startContest(
  ctx: APIRequestContext | BrowserContext,
  contestId: string,
): Promise<void> {
  await post(ctx, `/api/participant/contests/${contestId}/start`);
}

export async function saveAnswer(
  ctx: APIRequestContext | BrowserContext,
  contestId: string,
  contestQuestionId: string,
  body: { selectedOptionIds?: string[]; textAnswer?: string | null; markedForReview?: boolean },
): Promise<void> {
  await patch(ctx, `/api/participant/contests/${contestId}/answers/${contestQuestionId}`, body);
}

export async function submitCodeAndWait(
  ctx: APIRequestContext | BrowserContext,
  contestId: string,
  contestQuestionId: string,
  language: string,
  code: string,
): Promise<void> {
  await post(
    ctx,
    `/api/participant/contests/${contestId}/questions/${contestQuestionId}/submit`,
    { language, code },
  );
  const TERMINAL = new Set(["PASSED", "FAILED", "PARTIAL", "ERROR", "TIME_LIMIT_EXCEEDED", "RATE_LIMITED", "LOCKED"]);
  for (let i = 0; i < 60; i++) {
    const state = await getContestState(ctx, contestId);
    const status = state.answers?.[contestQuestionId]?.coding?.submit?.status;
    if (status && TERMINAL.has(status)) return;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for coding submission to finish grading (cq=${contestQuestionId})`);
}

export async function getContestState(
  ctx: APIRequestContext | BrowserContext,
  contestId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  return get(ctx, `/api/participant/contests/${contestId}`);
}

export async function submitContest(
  ctx: APIRequestContext | BrowserContext,
  contestId: string,
): Promise<void> {
  await post(ctx, `/api/participant/contests/${contestId}/submit`);
}

export async function getQuestionDetail(
  adminCtx: APIRequestContext | BrowserContext,
  questionId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const body = await get(adminCtx, `/api/admin/questions/${questionId}`);
  return body.question;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simple assertion helper — throws with a clear message on failure. */
export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${message}`);
}

let passCount = 0;
let failCount = 0;

export async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passCount++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${err instanceof Error ? err.stack ?? err.message : err}`);
    throw err;
  }
}

export function summarize(suiteName: string) {
  console.log(`\n${suiteName}: ${passCount} passed, ${failCount} failed\n`);
  if (failCount > 0) process.exitCode = 1;
}
