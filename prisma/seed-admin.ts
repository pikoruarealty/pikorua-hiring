import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { UserRole } from "../src/generated/prisma/enums";
import { hashPassword, validatePasswordComplexity } from "../src/lib/auth/password";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Masked prompt (readline has no built-in support for this) — echoes `*` per
// keystroke instead of the real character. Only usable on a real TTY.
function promptPassword(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("promptPassword requires an interactive TTY."));
      return;
    }
    process.stdout.write(label);
    const chars: string[] = [];
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onData = (input: string) => {
      switch (input) {
        case "\n":
        case "\r":
        case "": // Ctrl-D
          cleanup();
          process.stdout.write("\n");
          resolve(chars.join(""));
          break;
        case "": // Ctrl-C
          cleanup();
          process.stdout.write("\n");
          process.exit(1);
        case "": // Backspace (DEL)
        case "\b":
          if (chars.length > 0) {
            chars.pop();
            process.stdout.write("\b \b");
          }
          break;
        default:
          if (input >= " ") {
            chars.push(input);
            process.stdout.write("*");
          }
      }
    };

    function cleanup() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
    }

    process.stdin.on("data", onData);
  });
}

async function promptForAdminPassword(): Promise<string> {
  for (;;) {
    const password = await promptPassword("Enter password for the new admin account: ");
    const complaint = validatePasswordComplexity(password);
    if (complaint) {
      console.log(`✗ ${complaint}\n`);
      continue;
    }
    const confirmation = await promptPassword("Confirm password: ");
    if (confirmation !== password) {
      console.log("✗ Passwords did not match. Try again.\n");
      continue;
    }
    return password;
  }
}

async function wipeDatabase() {
  // Explicit child-to-parent order so this stays correct even if the
  // schema's onDelete/cascade settings change later — don't rely on
  // cascades alone to get this right.
  await prisma.$transaction([
    prisma.proctoringEvent.deleteMany(),
    prisma.attempt.deleteMany(),
    prisma.testCase.deleteMany(),
    prisma.codingQuestionConfig.deleteMany(),
    prisma.textAnswerConfig.deleteMany(),
    prisma.option.deleteMany(),
    prisma.contestQuestion.deleteMany(),
    prisma.contestParticipant.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.question.deleteMany(),
    prisma.contest.deleteMany(),
    prisma.session.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const confirmation = await rl.question(
    "This will PERMANENTLY DELETE every row in the database and create a " +
      "single admin user. Type 'yes' to continue: ",
  );
  rl.close();
  if (confirmation.trim().toLowerCase() !== "yes") {
    console.log("Aborted — nothing was changed.");
    return;
  }

  const username = "admin";
  const password = await promptForAdminPassword();

  console.log("\nWiping database…");
  await wipeDatabase();

  console.log("Creating admin user…");
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      username,
      passwordHash,
      role: UserRole.ADMIN,
      fullName: "Platform Admin",
    },
  });

  console.log(`\n✓ Done. Log in with username "${username}" and the password you entered.`);
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
