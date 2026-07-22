import { chromium } from "playwright";
import {
  BASE_URL,
  CREDENTIALS,
  assert,
  attachQuestion,
  createContest,
  createParticipant,
  inviteRoster,
  listQuestions,
  login,
  newApiContext,
  publishContest,
  sleep,
  step,
  summarize,
} from "./lib";

/**
 * Phase 5 checkpoint: real DOM-event-driven proctoring — fullscreen exit
 * (strike 1 -> warn) then a devtools-shortcut attempt (strike 2 -> auto
 * submit + LOCKED_OUT), verifying the exact warn/lockout UI copy.
 */
async function main() {
  console.log("\n=== Phase 5: Proctoring (warn then lockout) ===\n");

  const adminCtx = await newApiContext();
  await login(adminCtx, CREDENTIALS.admin.username, CREDENTIALS.admin.password);
  const carol = await createParticipant(adminCtx, "carol");
  const questions = await listQuestions(adminCtx);
  const mcq = questions.find((q) => q.type === "MCQ");
  assert(mcq, "seeded MCQ question not found");

  const contest = await createContest(adminCtx, { title: `E2E Phase5 ${Date.now()}` });
  await attachQuestion(adminCtx, contest.id, mcq!.id);
  await inviteRoster(adminCtx, contest.id, [carol.id]);
  await publishContest(adminCtx, contest.id);
  await step("contest setup (create, attach MCQ, invite carol, publish)", async () => {});

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await step("participant logs in and starts the contest", async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel("Username").fill(carol.username);
      await page.locator("#password").fill(carol.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`${BASE_URL}/participant`);
      await page.goto(`${BASE_URL}/participant/contests/${contest.id}`);
      await page.getByRole("button", { name: "Start contest" }).click();
      await page.getByText(/Question 1 of 1/).waitFor();
    });

    await step("strike 1: real fullscreen exit triggers a warning", async () => {
      // Starting the contest auto-requests fullscreen (contest-taking-client.tsx),
      // and headless Chromium actually grants it — so document.fullscreenElement
      // is already set. A synthetic dispatchEvent("fullscreenchange") wouldn't
      // change that, and the handler's `if (document.fullscreenElement) return`
      // guard would correctly no-op it. Call the real exitFullscreen() instead.
      await page.evaluate(() => document.exitFullscreen());
      await page
        .getByText(
          "Warning: leaving fullscreen, switching tabs, or attempting devtools/copy/print is being monitored. One more violation will end your contest.",
        )
        .waitFor({ timeout: 10_000 });
    });

    await step("strike 2 (after companion-suppression window): devtools shortcut triggers lockout", async () => {
      // COMPANION_SUPPRESS_MS is 800ms — wait past it so this counts as a
      // distinct violation rather than being coalesced with strike 1.
      await sleep(1000);
      await page.keyboard.press("F12");
      await page
        .getByText("Contest ended — proctoring violation", { exact: true })
        .waitFor({ timeout: 10_000 });
      await page
        .getByText(/Your contest was ended after repeated proctoring violations/)
        .waitFor();
    });

    await step("server-side: participant status is LOCKED_OUT on the admin leaderboard", async () => {
      const res = await adminCtx.get(`${BASE_URL}/api/admin/contests/${contest.id}/results`);
      const body = await res.json();
      const row = body.leaderboard.find(
        (r: { user: { username: string } }) => r.user.username === carol.username,
      );
      assert(row, "carol not found in leaderboard after lockout");
      assert(row.status === "LOCKED_OUT", `expected LOCKED_OUT, got ${row.status}`);
    });
  } finally {
    await browser.close();
  }

  summarize("Phase 5");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
