import { z } from "zod";
import { randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword, generatePassword } from "@/lib/auth/password";
import { UserRole } from "@/generated/prisma/enums";

/**
 * Participant domain rules: username/email/phone validation, username generation
 * for bulk imports that omit it, and credential issuance (generate a password,
 * store only its hash, return the plaintext exactly once).
 */

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/;

/** Normalize a username: trim + lowercase. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be 3–32 characters.")
  .max(32, "Username must be 3–32 characters.")
  .transform(normalizeUsername)
  .refine((v) => USERNAME_RE.test(v), {
    message:
      "Username may use lowercase letters, digits, dot, underscore, hyphen (not at the ends).",
  });

// Email is optional metadata; blank strings become undefined.
const optionalEmail = z
  .string()
  .trim()
  .email("Invalid email address.")
  .max(200)
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .regex(/^[+()\-\s0-9]{6,30}$/, "Invalid phone number.")
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalFullName = z
  .string()
  .trim()
  .max(120)
  .optional()
  .or(z.literal("").transform(() => undefined));

export const createParticipantSchema = z.object({
  username: usernameSchema,
  fullName: optionalFullName,
  email: optionalEmail,
  phone: optionalPhone,
});
export type CreateParticipantInput = z.infer<typeof createParticipantSchema>;

export const patchParticipantSchema = z
  .object({
    fullName: optionalFullName,
    email: optionalEmail,
    phone: optionalPhone,
    isActive: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "No fields to update.",
  });

// One row of a bulk import, before username generation. All fields optional so
// per-row validation can report specific problems rather than rejecting the file.
export const importRowSchema = z.object({
  username: z
    .string()
    .trim()
    .transform(normalizeUsername)
    .refine((v) => v === "" || USERNAME_RE.test(v), {
      message:
        "Username may use lowercase letters, digits, dot, underscore, hyphen (not at the ends).",
    })
    .optional(),
  fullName: optionalFullName,
  email: optionalEmail,
  phone: optionalPhone,
});

/** Generate a random, human-typeable username like `cand-7x4k9q`. */
function generateUsername(): string {
  const charset = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += charset[randomInt(charset.length)];
  return `cand-${s}`;
}

/**
 * Issue a fresh credential for a user: generate a strong password, store only
 * its argon2id hash, and return the plaintext for one-time display/export. Also
 * reactivates the account. Use the returned password immediately — it cannot be
 * recovered later, only re-issued.
 */
export async function issueCredential(
  userId: string,
): Promise<{ userId: string; password: string }> {
  const password = generatePassword();
  const passwordHash = await hashPassword(password);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, isActive: true },
  });
  return { userId, password };
}

/**
 * True if a username is already used — in this batch (`taken`) or in the DB.
 * Used to SKIP-and-report explicit duplicate usernames rather than silently
 * renaming a username the admin chose deliberately.
 */
export async function isUsernameTaken(
  username: string,
  taken: Set<string>,
): Promise<boolean> {
  if (taken.has(username)) return true;
  return usernameExists(username);
}

/**
 * Generate a fresh unique username (for import rows that omit one). Suffixing is
 * appropriate here because the name is system-assigned, not admin-chosen. `taken`
 * is a live set the caller mutates so two rows in the same batch don't collide.
 */
export async function generateUniqueUsername(
  taken: Set<string>,
): Promise<string> {
  let name = generateUsername();
  let guard = 0;
  while ((taken.has(name) || (await usernameExists(name))) && guard++ < 1000) {
    name = generateUsername();
  }
  taken.add(name);
  return name;
}

async function usernameExists(username: string): Promise<boolean> {
  const found = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });
  return found !== null;
}

export const PARTICIPANT_WHERE = { role: UserRole.PARTICIPANT } as const;
