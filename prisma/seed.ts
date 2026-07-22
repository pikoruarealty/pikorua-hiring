import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  UserRole,
  QuestionType,
  QuestionDifficulty,
} from "../src/generated/prisma/enums";
import { hashPassword } from "../src/lib/auth/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Fixed dev credentials for a reproducible Phase 0 checkpoint. NEVER used in prod.
const DEV_USERS = [
  { username: "admin", password: "Admin@12345", role: UserRole.ADMIN, fullName: "Platform Admin", email: "admin@example.com" },
  { username: "alice", password: "Alice@12345", role: UserRole.PARTICIPANT, fullName: "Alice Candidate", email: "alice@example.com" },
  { username: "bob", password: "Bobby@12345", role: UserRole.PARTICIPANT, fullName: "Bob Candidate", email: "bob@example.com" },
] as const;

async function seedUsers() {
  const results = [];
  for (const u of DEV_USERS) {
    const passwordHash = await hashPassword(u.password);
    const user = await prisma.user.upsert({
      where: { username: u.username },
      // Reset password on re-seed so documented dev credentials always hold.
      update: { role: u.role, fullName: u.fullName, email: u.email, passwordHash },
      create: {
        username: u.username,
        email: u.email,
        passwordHash,
        role: u.role,
        fullName: u.fullName,
      },
    });
    results.push(user);
  }
  return results;
}

async function seedQuestions(adminId: string) {
  // Idempotency: skip if a bank already has our sample questions (by title).
  const existing = await prisma.question.findFirst({
    where: { title: "Sample: Identify the prime numbers" },
    select: { id: true },
  });
  if (existing) return;

  // MCQ — partial credit via signed per-option scores.
  await prisma.question.create({
    data: {
      type: QuestionType.MCQ,
      title: "Sample: Identify the prime numbers",
      body: "Select all numbers below that are prime.",
      defaultPoints: 4,
      difficulty: QuestionDifficulty.EASY,
      tags: ["math", "sample"],
      createdById: adminId,
      options: {
        create: [
          { text: "2", score: 2, order: 0, isCorrect: true },
          { text: "9", score: 0, order: 1, isCorrect: false },
          { text: "7", score: 2, order: 2, isCorrect: true },
          { text: "15", score: 0, order: 3, isCorrect: false },
        ],
      },
    },
  });

  // TEXT — case-insensitive, trimmed, single correct string.
  await prisma.question.create({
    data: {
      type: QuestionType.TEXT,
      title: "Sample: Capital of France",
      body: "What is the capital city of France?",
      defaultPoints: 2,
      difficulty: QuestionDifficulty.EASY,
      tags: ["geography", "sample"],
      createdById: adminId,
      textAnswerConfig: { create: { correctAnswer: "Paris" } },
    },
  });

  // CODING — stdin/stdout, partial scoring across test cases.
  await prisma.question.create({
    data: {
      type: QuestionType.CODING,
      title: "Sample: Sum of two integers",
      body: "Read two space-separated integers from stdin and print their sum.",
      defaultPoints: 10,
      difficulty: QuestionDifficulty.EASY,
      tags: ["implementation", "sample"],
      createdById: adminId,
      codingConfig: {
        create: {
          timeLimitSeconds: 5,
          memoryLimitMb: 128,
          allowedLanguages: ["python", "c", "cpp", "java"],
          defaultHardLockSeconds: 600,
          starterCode: {
            python: "import sys\n\na, b = map(int, sys.stdin.read().split())\n# TODO: print the sum of a and b\n",
          },
          testCases: {
            create: [
              { input: "2 3\n", expectedOutput: "5", isSample: true, score: 2, order: 0 },
              { input: "10 20\n", expectedOutput: "30", isSample: true, score: 2, order: 1 },
              { input: "-5 8\n", expectedOutput: "3", isSample: false, score: 3, order: 2 },
              { input: "1000000 2000000\n", expectedOutput: "3000000", isSample: false, score: 3, order: 3 },
            ],
          },
        },
      },
    },
  });
}

async function main() {
  const users = await seedUsers();
  const admin = users.find((u) => u.role === UserRole.ADMIN)!;
  await seedQuestions(admin.id);

  console.log("\nSeed complete. Dev credentials:");
  console.table(
    DEV_USERS.map((u) => ({ username: u.username, password: u.password, role: u.role })),
  );
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
