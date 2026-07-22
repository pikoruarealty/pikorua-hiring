import { chromium, request } from "playwright";
import {
  BASE_URL,
  CREDENTIALS,
  assert,
  attachQuestion,
  createContest,
  createParticipant,
  getContestState,
  getQuestionDetail,
  inviteRoster,
  listQuestions,
  login,
  newApiContext,
  publishContest,
  saveAnswer,
  sleep,
  startContest,
  step,
  submitCodeAndWait,
  submitContest,
  summarize,
} from "./lib";

/**
 * Phase 6 checkpoint: leaderboard tie-break ordering, participant drilldown
 * (including hidden coding test-case output), all three export formats, and
 * the shortlist-into-another-contest flow.
 *
 * Tie-break nuance (per the scoring code, compareForRanking only treats rows
 * as a literal tie if score AND submittedAt-to-the-millisecond AND
 * tieBreakExecutionTimeMs all match — unreachable via independently driven
 * sessions). The achievable, meaningful test below is: 3 participants who
 * answer identically to reach an equal totalScore, then verifying they are
 * ranked in the correct relative order by earliest submittedAt — the real
 * tie-break rule — rather than asserting a shared literal rank number.
 */
async function main() {
  console.log("\n=== Phase 6: Leaderboard, drilldown, export, shortlist ===\n");

  const adminCtx = await newApiContext();
  await login(adminCtx, CREDENTIALS.admin.username, CREDENTIALS.admin.password);

  const questions = await listQuestions(adminCtx);
  const mcq = questions.find((q) => q.type === "MCQ")!;
  const text = questions.find((q) => q.type === "TEXT")!;
  const coding = questions.find((q) => q.type === "CODING")!;
  const mcqDetail = await getQuestionDetail(adminCtx, mcq.id);
  const correctOptionIds = mcqDetail.options
    .filter((o: { isCorrect: boolean }) => o.isCorrect)
    .map((o: { id: string }) => o.id);
  assert(correctOptionIds.length === 2, "expected 2 correct MCQ options in seed data");

  // ---- Part A: 3-way score tie, ranked by earliest submittedAt ----
  const tieContest = await createContest(adminCtx, { title: `E2E Phase6 Tie ${Date.now()}` });
  await attachQuestion(adminCtx, tieContest.id, mcq.id);
  await attachQuestion(adminCtx, tieContest.id, text.id);

  const participants = await Promise.all(
    ["p1", "p2", "p3"].map((label) => createParticipant(adminCtx, label)),
  );
  await inviteRoster(
    adminCtx,
    tieContest.id,
    participants.map((p) => p.id),
  );
  await publishContest(adminCtx, tieContest.id);
  await step("tie contest setup: MCQ+TEXT, 3 participants invited, published", async () => {});

  const submissionOrder: string[] = [];
  for (const p of participants) {
    const pCtx = await request.newContext({ baseURL: BASE_URL });
    await login(pCtx, p.username, p.password);
    await startContest(pCtx, tieContest.id);
    const state = await getContestState(pCtx, tieContest.id);
    const mcqCq = state.questions.find((q: { question: { type: string } }) => q.question.type === "MCQ");
    const textCq = state.questions.find((q: { question: { type: string } }) => q.question.type === "TEXT");
    await saveAnswer(pCtx, tieContest.id, mcqCq.id, {
      selectedOptionIds: correctOptionIds,
      markedForReview: false,
    });
    await saveAnswer(pCtx, tieContest.id, textCq.id, { textAnswer: "Paris", markedForReview: false });
    await submitContest(pCtx, tieContest.id);
    submissionOrder.push(p.username);
    await pCtx.dispose();
    // Guarantee strictly increasing submittedAt across the three participants.
    await sleep(500);
  }
  await step(
    `3 participants (${submissionOrder.join(" -> ")}) answered identically and submitted in sequence`,
    async () => {},
  );

  await step("leaderboard: equal totalScore, ranked by earliest submittedAt", async () => {
    const res = await adminCtx.get(`${BASE_URL}/api/admin/contests/${tieContest.id}/results`);
    const body = await res.json();
    const rows = body.leaderboard as Array<{
      rank: number;
      totalScore: string | number;
      user: { username: string };
    }>;
    assert(rows.length === 3, `expected 3 leaderboard rows, got ${rows.length}`);
    const scores = new Set(rows.map((r) => String(r.totalScore)));
    assert(scores.size === 1, `expected all 3 scores equal, got ${[...scores].join(", ")}`);
    const orderedUsernames = [...rows].sort((a, b) => a.rank - b.rank).map((r) => r.user.username);
    assert(
      JSON.stringify(orderedUsernames) === JSON.stringify(submissionOrder),
      `expected rank order ${submissionOrder.join(",")}, got ${orderedUsernames.join(",")}`,
    );
  });

  // ---- Part B: coding drilldown (hidden test-case output) ----
  const codingContest = await createContest(adminCtx, {
    title: `E2E Phase6 CodingDrilldown ${Date.now()}`,
  });
  await attachQuestion(adminCtx, codingContest.id, coding.id);
  const p4 = await createParticipant(adminCtx, "p4");
  await inviteRoster(adminCtx, codingContest.id, [p4.id]);
  await publishContest(adminCtx, codingContest.id);
  const p4Ctx = await request.newContext({ baseURL: BASE_URL });
  await login(p4Ctx, p4.username, p4.password);
  await startContest(p4Ctx, codingContest.id);
  const p4State = await getContestState(p4Ctx, codingContest.id);
  const codingCq = p4State.questions[0];
  assert(codingCq.id, "coding contestQuestion id missing");
  await submitCodeAndWait(
    p4Ctx,
    codingContest.id,
    codingCq.id,
    "python",
    "import sys\na, b = map(int, sys.stdin.read().split())\nprint(a + b)\n",
  );
  await submitContest(p4Ctx, codingContest.id);
  await p4Ctx.dispose();
  await step("coding drilldown contest: p4 submitted a fully-correct solution", async () => {});

  // ---- Browser-driven: admin UI verification ----
  const browser = await chromium.launch();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    await step("admin logs in through the real login form", async () => {
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel("Username").fill(CREDENTIALS.admin.username);
      await page.locator("#password").fill(CREDENTIALS.admin.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(`${BASE_URL}/admin`);
    });

    await step("leaderboard table visually shows the 3 tied rows in submission order", async () => {
      await page.goto(`${BASE_URL}/admin/contests/${tieContest.id}`);
      await page.getByRole("tab", { name: "Results" }).click();
      await page.getByText(`Leaderboard (3)`).waitFor();
      const rows = page.locator("table tbody tr");
      await rows.first().waitFor();
      const usernames = await rows.locator("td.font-mono").allTextContents();
      assert(
        JSON.stringify(usernames) === JSON.stringify(submissionOrder),
        `DOM row order expected ${submissionOrder.join(",")}, got ${usernames.join(",")}`,
      );
    });

    await step("all three export formats download successfully", async () => {
      await page.locator('thead button[role="checkbox"]').click(); // select all
      for (const [label, ext] of [
        ["All → CSV", "csv"],
        ["All → XLSX", "xlsx"],
        ["All → PDF", "pdf"],
      ] as const) {
        await page.getByRole("button", { name: "Export" }).click();
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15_000 }),
          page.getByRole("menuitem", { name: label }).click(),
        ]);
        const filename = download.suggestedFilename();
        assert(
          filename.toLowerCase().endsWith(`.${ext}`),
          `expected .${ext} download for "${label}", got ${filename}`,
        );
      }
    });

    await step("shortlist selected participant into a second invite-only contest", async () => {
      const targetContest = await createContest(adminCtx, {
        title: `E2E Phase6 ShortlistTarget ${Date.now()}`,
      });
      await page.reload();
      await page.getByRole("tab", { name: "Results" }).click();
      // Deselect-all then select just the first row's checkbox.
      const rows = page.locator("table tbody tr");
      await rows.first().locator('button[role="checkbox"]').click();
      await page.getByRole("button", { name: /Shortlist selected \(1\)/ }).click();
      await page.getByRole("heading", { name: "Shortlist into another contest" }).waitFor();
      await page.getByRole("combobox").click();
      await page.getByRole("option", { name: new RegExp(targetContest.title) }).click();
      await page.getByRole("button", { name: "Shortlist", exact: true }).click();
      await page.getByText(/Shortlisted 1 participant/).waitFor({ timeout: 10_000 });

      const rosterRes = await adminCtx.get(
        `${BASE_URL}/api/admin/contests/${targetContest.id}/participants`,
      );
      const roster = await rosterRes.json();
      assert(roster.roster.length === 1, `expected 1 roster entry, got ${roster.roster.length}`);
      assert(
        roster.roster[0].status === "INVITED",
        `expected shortlisted participant status INVITED, got ${roster.roster[0].status}`,
      );
    });

    await step("participant drilldown shows hidden test-case output for coding", async () => {
      await page.goto(`${BASE_URL}/admin/contests/${codingContest.id}`);
      await page.getByRole("tab", { name: "Results" }).click();
      await page.locator("table tbody tr").first().click();
      await page.getByText("Hidden", { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.getByText("print(a + b)").waitFor();
    });
  } finally {
    await browser.close();
  }

  summarize("Phase 6");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
