/**
 * Canonical internal language codes for coding questions. Mapping these to
 * Piston's runtime/version identifiers is a Phase 4 (execution worker)
 * concern — this module is the shared vocabulary the question editor (Phase 2)
 * and the executor (Phase 4) both validate against.
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
