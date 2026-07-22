"use client";

import Editor from "@monaco-editor/react";
import { useTheme } from "next-themes";

const MONACO_LANGUAGE: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  java: "java",
  python: "python",
};

/**
 * Contest code editor. Per initial-prompt.md: IntelliSense, autocomplete
 * suggestions, quick-suggestions, and parameter hints are all disabled —
 * candidates get a plain editor, not an assisted one.
 */
export function CodeEditor({
  language,
  value,
  onChange,
  readOnly = false,
}: {
  language: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const { resolvedTheme } = useTheme();

  return (
    <Editor
      height="100%"
      language={MONACO_LANGUAGE[language] ?? "plaintext"}
      value={value}
      onChange={(v) => onChange(v ?? "")}
      theme={resolvedTheme === "dark" ? "vs-dark" : "light"}
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 14,
        automaticLayout: true,
        // --- Disabled per initial-prompt.md ---
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        parameterHints: { enabled: false },
        wordBasedSuggestions: "off",
        acceptSuggestionOnEnter: "off",
        tabCompletion: "off",
        snippetSuggestions: "none",
        suggest: { showWords: false, showSnippets: false },
        hover: { enabled: "off" },
        occurrencesHighlight: "off" as const,
        codeLens: false,
        contextmenu: false,
      }}
    />
  );
}
