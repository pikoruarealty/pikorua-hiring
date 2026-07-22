"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/client/api";
import { ProctoringEventType } from "@/generated/prisma/enums";

export interface ProctoringOutcome {
  action: "NONE" | "WARNED" | "AUTO_SUBMITTED";
  cumulativeCount: number | null;
  status: string;
}

// fullscreenchange and blur/visibilitychange routinely fire together for the
// same real action (e.g. exiting fullscreen also blurs the window) — without
// coalescing, one alt-tab would burn two strikes instead of one.
const COMPANION_SUPPRESS_MS = 800;

/**
 * Attaches proctoring detectors (fullscreen exit, tab blur, visibility
 * change, devtools shortcuts, right-click, copy/paste, print) for the
 * duration the contest is IN_PROGRESS, and reports each to the server. Only
 * active while `enabled` is true — callers should gate this on
 * "participant has started and hasn't finished."
 */
export function useProctoring(
  contestId: string,
  enabled: boolean,
  onOutcome: (outcome: ProctoringOutcome) => void,
) {
  const onOutcomeRef = useRef(onOutcome);
  useEffect(() => {
    onOutcomeRef.current = onOutcome;
  }, [onOutcome]);

  useEffect(() => {
    if (!enabled) return;

    let suppressCompanionUntil = 0;

    async function report(eventType: string, metadata?: Record<string, unknown>) {
      try {
        const res = await apiFetch(`/api/participant/contests/${contestId}/proctoring-events`, {
          method: "POST",
          body: JSON.stringify({
            eventType,
            clientTimestamp: new Date().toISOString(),
            metadata,
          }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as ProctoringOutcome;
        onOutcomeRef.current(body);
      } catch {
        // Best-effort — a dropped report just means one fewer data point.
      }
    }

    function onFullscreenChange() {
      if (document.fullscreenElement) return;
      suppressCompanionUntil = Date.now() + COMPANION_SUPPRESS_MS;
      report(ProctoringEventType.FULLSCREEN_EXIT);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        suppressCompanionUntil = Date.now() + COMPANION_SUPPRESS_MS;
        report(ProctoringEventType.VISIBILITY_HIDDEN);
      } else {
        report(ProctoringEventType.FOCUS_RETURN);
      }
    }

    function onBlur() {
      if (Date.now() < suppressCompanionUntil) return;
      report(ProctoringEventType.TAB_BLUR);
    }

    function onFocus() {
      report(ProctoringEventType.FOCUS_RETURN);
    }

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      const isDevtools =
        key === "f12" ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(key)) ||
        ((e.ctrlKey || e.metaKey) && key === "u");
      if (isDevtools) {
        e.preventDefault();
        report(ProctoringEventType.DEVTOOLS_ATTEMPT, { key });
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "p") {
        e.preventDefault();
        report(ProctoringEventType.PRINT_ATTEMPT);
      }
    }

    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
      report(ProctoringEventType.RIGHT_CLICK);
    }

    function onCopyOrPaste(e: ClipboardEvent) {
      e.preventDefault();
      report(ProctoringEventType.COPY_PASTE, { clipboardEvent: e.type });
    }

    function onBeforePrint() {
      report(ProctoringEventType.PRINT_ATTEMPT);
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onCopyOrPaste);
    document.addEventListener("paste", onCopyOrPaste);
    window.addEventListener("beforeprint", onBeforePrint);

    // Best-effort, one-shot multi-monitor check (Window Management API,
    // Chromium-only; silently absent elsewhere).
    const screenAny = window.screen as Screen & { isExtended?: boolean };
    if (screenAny.isExtended) {
      report(ProctoringEventType.MULTI_MONITOR_DETECTED);
    }

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onCopyOrPaste);
      document.removeEventListener("paste", onCopyOrPaste);
      window.removeEventListener("beforeprint", onBeforePrint);
    };
  }, [contestId, enabled]);
}
