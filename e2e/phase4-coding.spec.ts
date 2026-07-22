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
  step,
  summarize,
} from "./lib";

/**
 * Phase 4 checkpoint: real-browser coding flow — Monaco typing, live SSE
 * "Run" results, "Submit code", and the per-question hard-lock countdown
 * actually disabling Run/Submit once it expires.
 */
async function main() {
  console.log("\n=== Phase 4: Coding flow (Monaco + SSE run/submit + hard lock) ===\n");

  const adminCtx = await newApiContext();
  await login(adminCtx, CREDENTIALS.admin.username, CREDENTIALS.admin.password);
  const bob = await createParticipant(adminCtx, "bob");
  const questions = await listQuestions(adminCtx);
  const coding = questions.find((q) => q.type === "CODING");
  assert(coding, "seeded CODING question not found");

  const contest = await createContest(adminCtx, { title: `E2E Phase4 ${Date.now()}` });
  // Short hard-lock so the countdown-expiry assertion doesn't take forever.
  await attachQuestion(adminCtx, contest.id, coding!.id, { hardLockSecondsOverride: 30 });
  await inviteRoster(adminCtx, contest.id, [bob.id]);
  await publishContest(adminCtx, contest.id);
  await step("contest setup (create, attach CODING w/ 30s hard lock, invite, publish)", async () => {});

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await step("participant logs in and starts the contest", async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel("Username").fill(bob.username);
      await page.locator("#password").fill(bob.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`${BASE_URL}/participant`);
      await page.goto(`${BASE_URL}/participant/contests/${contest.id}`);
      await page.getByRole("button", { name: "Start contest" }).click();
      await page.getByText(/Question 1 of 1/).waitFor();
    });

    const editor = page.locator(".monaco-editor").first();
    await step("Monaco editor loads with the seeded Python starter code", async () => {
      await editor.waitFor();
      await page.locator(".monaco-editor .view-line", { hasText: "TODO" }).waitFor();
    });

    await step("type a correct solution into the editor", async () => {
      await editor.click();
      await page.keyboard.press("Control+A");
      await page.keyboard.type(
        "import sys\na, b = map(int, sys.stdin.read().split())\nprint(a + b)\n",
        { delay: 40 },
      );
      await page.locator(".monaco-editor .view-line", { hasText: "print(a + b)" }).waitFor();
    });

    await step('"Run" streams live SSE results into the Result tab', async () => {
      await page.getByRole("button", { name: "Run", exact: true }).click();
      await page
        .getByRole("tab", { name: /Result/ })
        .locator("text=/PASSED|FAILED|COMPILE_ERROR/")
        .waitFor({ timeout: 30_000 });
      const sampleCards = page.locator("text=Sample test");
      assert((await sampleCards.count()) >= 1, "expected at least one sample test result card");
    });

    await step('"Submit code" grades against hidden tests too', async () => {
      // Run and Submit share a per-user rate-limit window (RATE_LIMIT_RUN_SUBMIT_SECONDS,
      // default 5s) — wait past it so Submit isn't rejected with 429 right after Run.
      await page.waitForTimeout(5500);
      await page.getByRole("button", { name: "Submit code", exact: true }).click();
      await page.getByText("Code submitted for grading").waitFor();
      await page
        .getByRole("tab", { name: /Result/ })
        .locator("text=/PASSED|FAILED|COMPILE_ERROR/")
        .waitFor({ timeout: 30_000 });
      const hiddenCards = page.locator("text=Hidden test");
      assert((await hiddenCards.count()) >= 1, "expected hidden test result cards after submit");
    });

    await step("hard-lock countdown eventually disables Run/Submit", async () => {
      await page.getByText(/Locks in \d/).waitFor();
      await page
        .getByText("This question's time limit has expired")
        .waitFor({ timeout: 40_000 });
      assert(
        await page.getByRole("button", { name: "Run", exact: true }).isDisabled(),
        "Run should be disabled after hard lock",
      );
      assert(
        await page.getByRole("button", { name: "Submit code", exact: true }).isDisabled(),
        "Submit code should be disabled after hard lock",
      );
    });
  } finally {
    await browser.close();
  }

  summarize("Phase 4");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
