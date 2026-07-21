import argon2 from "argon2";
import { randomInt } from "node:crypto";

/**
 * Password hashing with argon2id (OWASP baseline params). argon2 ships prebuilt
 * binaries; no native build toolchain required.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash, etc. Treat as non-match rather than throwing.
    return false;
  }
}

// Unambiguous charset for generated credentials (no O/0, l/1/I) so they can be
// read off a printed PDF without confusion.
const GEN_CHARSET =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#$%&*+?";

/**
 * Generate a strong random password. Default length 16 from a 60-char
 * unambiguous set (~94 bits of entropy). Uses crypto.randomInt (rejection
 * sampling, unbiased).
 */
export function generatePassword(length = 16): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += GEN_CHARSET[randomInt(GEN_CHARSET.length)];
  }
  return out;
}

/**
 * Minimum complexity for admin-set passwords: >= 10 chars with at least three
 * of {lowercase, uppercase, digit, symbol}. Generated passwords already exceed
 * this. Returns null if valid, else an error message.
 */
export function validatePasswordComplexity(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  const classes = [
    /[a-z]/.test(pw),
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^a-zA-Z0-9]/.test(pw),
  ].filter(Boolean).length;
  if (classes < 3) {
    return "Password must include at least three of: lowercase, uppercase, digit, symbol.";
  }
  return null;
}
