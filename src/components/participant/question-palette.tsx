"use client";

import { cn } from "@/lib/utils";
import type { AnswerState, ParticipantQuestion, PaletteStatus } from "./types";
import { paletteStatus } from "./types";

const STATUS_CLASS: Record<PaletteStatus, string> = {
  NOT_VISITED: "bg-muted text-muted-foreground border-border",
  NOT_ANSWERED: "bg-destructive/15 text-destructive border-destructive/30",
  ANSWERED: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  MARKED: "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-400",
  ANSWERED_MARKED:
    "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-400 ring-2 ring-emerald-500/50",
};

const LEGEND: { status: PaletteStatus; label: string }[] = [
  { status: "NOT_VISITED", label: "Not visited" },
  { status: "NOT_ANSWERED", label: "Not answered" },
  { status: "ANSWERED", label: "Answered" },
  { status: "MARKED", label: "Marked for review" },
  { status: "ANSWERED_MARKED", label: "Answered & marked" },
];

export function QuestionPalette({
  questions,
  answers,
  currentIndex,
  onSelect,
}: {
  questions: ParticipantQuestion[];
  answers: Record<string, AnswerState>;
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-5 gap-2">
        {questions.map((q, i) => {
          const status = paletteStatus(answers[q.id]);
          return (
            <button
              key={q.id}
              onClick={() => onSelect(i)}
              className={cn(
                "flex size-9 items-center justify-center rounded-md border text-sm font-medium transition-colors",
                STATUS_CLASS[status],
                i === currentIndex && "outline outline-2 outline-offset-1 outline-ring",
              )}
              aria-current={i === currentIndex}
              aria-label={`Question ${i + 1}: ${status.replaceAll("_", " ").toLowerCase()}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      <div className="grid gap-1 border-t pt-3 text-xs text-muted-foreground">
        {LEGEND.map((l) => (
          <div key={l.status} className="flex items-center gap-2">
            <span className={cn("size-3 rounded border", STATUS_CLASS[l.status])} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
