/**
 * Canonical internal language codes for coding questions. This module is the
 * shared vocabulary the question editor (Phase 2) and the executor
 * (Phase 4 worker) both validate against.
 */
export const SUPPORTED_LANGUAGES = ["c", "cpp", "java", "python"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  c: "C",
  cpp: "C++",
  java: "Java",
  python: "Python",
};

export function isSupportedLanguage(v: string): v is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(v);
}

/**
 * Mapping to Piston's `/api/v2/execute` runtime identifiers. "c" and "cpp"
 * both run through Piston's single `gcc` package install (it aliases the
 * runtime to both languages); versions must match what `scripts/piston-install.ts`
 * actually installed on the target Piston instance.
 */
export const PISTON_RUNTIME: Record<SupportedLanguage, { language: string; version: string }> = {
  c: { language: "c", version: "10.2.0" },
  cpp: { language: "c++", version: "10.2.0" },
  java: { language: "java", version: "15.0.2" },
  python: { language: "python", version: "3.12.0" },
};

/** File name Piston expects per language so it compiles/runs correctly. */
export const PISTON_SOURCE_FILENAME: Record<SupportedLanguage, string> = {
  c: "main.c",
  cpp: "main.cpp",
  java: "Main.java",
  python: "main.py",
};
