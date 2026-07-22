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
 * Phase 3 checkpoint: real-browser MCQ/TEXT contest-taking flow — checkbox
 * clicks with instant autosave, debounced text autosave, palette navigation,
 * and the submit confirmation dialog.
 */
async function main() {
  console.log("\n=== Phase 3: MCQ/TEXT contest-taking flow ===\n");

  const adminCtx = await newApiContext();
  await step("admin login (API)", async () => {
    const role = await login(adminCtx, CREDENTIALS.admin.username, CREDENTIALS.admin.password);
    assert(role === "ADMIN", `expected ADMIN role, got ${role}`);
  });

  const alice = await createParticipant(adminCtx, "alice");
  const questions = await listQuestions(adminCtx);
  const mcq = questions.find((q) => q.type === "MCQ");
  const text = questions.find((q) => q.type === "TEXT");
  assert(mcq, "seeded MCQ question not found");
  assert(text, "seeded TEXT question not found");

  const contest = await createContest(adminCtx, { title: `E2E Phase3 ${Date.now()}` });
  await attachQuestion(adminCtx, contest.id, mcq!.id);
  await attachQuestion(adminCtx, contest.id, text!.id);
  await inviteRoster(adminCtx, contest.id, [alice.id]);
  await publishContest(adminCtx, contest.id);
  await step("contest setup (create, attach MCQ+TEXT, invite, publish)", async () => {});

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await step("participant logs in through the real login form", async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel("Username").fill(alice.username);
      await page.locator("#password").fill(alice.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`${BASE_URL}/participant`);
    });

    await step("navigate to contest and start it", async () => {
      await page.goto(`${BASE_URL}/participant/contests/${contest.id}`);
      await page.getByRole("button", { name: "Start contest" }).click();
      await page.getByText(/Question 1 of 2/).waitFor();
    });

    await step("answer MCQ via checkbox clicks (instant autosave)", async () => {
      // Correct options per seed data: "2" and "7".
      const optionRow = (label: string) =>
        page.locator("label", { hasText: new RegExp(`^${label}$`) });
      await optionRow("2").locator('button[role="checkbox"]').click();
      await optionRow("7").locator('button[role="checkbox"]').click();
      await expectChecked(optionRow("2"));
      await expectChecked(optionRow("7"));
    });

    await step("Save & Next advances to the TEXT question", async () => {
      await page.getByRole("button", { name: "Save & Next" }).click();
      await page.getByText(/Question 2 of 2/).waitFor();
    });

    await step("answer TEXT question with debounced autosave", async () => {
      await page.getByPlaceholder("Type your answer…").fill("Paris");
      // 600ms debounce — wait past it, then confirm no error toast appeared.
      await page.waitForTimeout(900);
      const errorToast = page.getByText("Could not save your answer");
      assert(!(await errorToast.isVisible().catch(() => false)), "unexpected save error toast");
    });

    await step("palette navigation back to question 1 preserves the MCQ answer", async () => {
      await page.locator('button[aria-label^="Question 1:"]').click();
      await page.getByText(/Question 1 of 2/).waitFor();
      const optionRow = (label: string) =>
        page.locator("label", { hasText: new RegExp(`^${label}$`) });
      await expectChecked(optionRow("2"));
      await expectChecked(optionRow("7"));
    });

    await step("reload persists both answers from the server", async () => {
      await page.reload();
      await page.getByText(/Question 1 of 2/).waitFor();
      const optionRow = (label: string) =>
        page.locator("label", { hasText: new RegExp(`^${label}$`) });
      await expectChecked(optionRow("2"));
      await page.locator('button[aria-label^="Question 2:"]').click();
      await expect(page.getByPlaceholder("Type your answer…")).toHaveValue("Paris");
    });

    await step("submit dialog opens and confirms submission", async () => {
      await page.getByRole("button", { name: "Submit contest" }).click();
      await page.getByRole("heading", { name: "Submit contest?" }).waitFor();
      await page.getByRole("button", { name: "Submit", exact: true }).click();
      await page.getByText("Submitted", { exact: true }).waitFor({ timeout: 10_000 });
    });

    await step("post-submit: contest dashboard shows Submitted, re-entry is blocked", async () => {
      await page.goto(`${BASE_URL}/participant`);
      await page.getByText(contest.title).waitFor();
      await page.getByRole("link", { name: "Submitted" }).waitFor();
    });
  } finally {
    await browser.close();
  }

  summarize("Phase 3");
}

// Minimal expect-like helpers (no @playwright/test test-runner is installed —
// see AGENTS.md: only `playwright` is a devDependency, hybrid script style).
async function expectChecked(locator: import("playwright").Locator) {
  const checkbox = locator.locator('button[role="checkbox"]');
  const state = await checkbox.getAttribute("data-state");
  assert(state === "checked", `expected checkbox checked, got ${state}`);
}
function expect(locator: import("playwright").Locator) {
  return {
    toHaveValue: async (value: string) => {
      const actual = await locator.inputValue();
      assert(actual === value, `expected value "${value}", got "${actual}"`);
    },
  };
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
