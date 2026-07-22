"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QuestionPalette } from "./question-palette";
import type { AnswerState, ContestStateResponse } from "./types";

const RESYNC_MS = 20_000;
const TEXT_DEBOUNCE_MS = 600;

function defaultAnswer(): AnswerState {
  return { selectedOptionIds: [], textAnswer: null, visited: false, markedForReview: false };
}

function fmtIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function ContestTakingClient({ contestId }: { contestId: string }) {
  const [data, setData] = useState<ContestStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);

  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const submittingRef = useRef(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/participant/contests/${contestId}`);
    if (!res.ok) {
      toast.error("Failed to load contest");
      return null;
    }
    const body = (await res.json()) as ContestStateResponse;
    setData(body);
    if (body.answers) setAnswers(body.answers);
    if (body.remainingSeconds !== null) setRemaining(body.remainingSeconds);
    if (body.participant?.status === "SUBMITTED" || body.participant?.status === "AUTO_SUBMITTED") {
      setFinalStatus(body.participant.status);
    }
    return body;
  }, [contestId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  // Periodic server resync — the client's own countdown is a display
  // estimate only; this is what keeps it honest.
  useEffect(() => {
    if (!data?.participant || finalStatus) return;
    const t = setInterval(load, RESYNC_MS);
    return () => clearInterval(t);
  }, [data?.participant, finalStatus, load]);

  const handleSubmit = useCallback(
    async (auto: boolean) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const res = await apiFetch(`/api/participant/contests/${contestId}/submit`, {
          method: "POST",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(body.error ?? "Submit failed");
          submittingRef.current = false;
          return;
        }
        setFinalStatus(body.status);
        toast.success(auto ? "Time's up — contest auto-submitted" : "Contest submitted");
      } catch {
        toast.error("Network error while submitting");
        submittingRef.current = false;
      } finally {
        setSubmitting(false);
      }
    },
    [contestId],
  );

  // Countdown ticker; fires the auto-submit exactly once when it hits zero.
  useEffect(() => {
    if (remaining === null || finalStatus) return;
    if (remaining <= 0) {
      handleSubmit(true);
      return;
    }
    const t = setTimeout(() => setRemaining((r) => (r ?? 1) - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, finalStatus, handleSubmit]);

  async function persist(cqId: string, patch: Partial<AnswerState>) {
    const merged = { ...(answers[cqId] ?? defaultAnswer()), ...patch, visited: true };
    setAnswers((prev) => ({ ...prev, [cqId]: merged }));
    try {
      const res = await apiFetch(`/api/participant/contests/${contestId}/answers/${cqId}`, {
        method: "PATCH",
        body: JSON.stringify({
          selectedOptionIds: merged.selectedOptionIds,
          textAnswer: merged.textAnswer,
          markedForReview: merged.markedForReview,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Could not save your answer");
      }
    } catch {
      toast.error("Network error saving your answer");
    }
  }

  function updateLocal(cqId: string, patch: Partial<AnswerState>) {
    setAnswers((prev) => ({ ...prev, [cqId]: { ...(prev[cqId] ?? defaultAnswer()), ...patch } }));
  }

  function debouncedSave(cqId: string, patch: Partial<AnswerState>) {
    updateLocal(cqId, patch);
    clearTimeout(debounceRef.current[cqId]);
    debounceRef.current[cqId] = setTimeout(() => {
      persist(cqId, patch);
    }, TEXT_DEBOUNCE_MS);
  }

  const questions = data?.questions ?? [];
  const current = questions[currentIndex];

  // Mark the newly-focused question visited, regardless of how we got here.
  useEffect(() => {
    if (!current || current.question.type === "CODING") return;
    const a = answers[current.id] ?? defaultAnswer();
    if (a.visited) return;
    persist(current.id, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  async function handleStart() {
    setStarting(true);
    try {
      const res = await apiFetch(`/api/participant/contests/${contestId}/start`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not start contest");
        return;
      }
      await load();
    } catch {
      toast.error("Network error");
    } finally {
      setStarting(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (finalStatus) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {finalStatus === "AUTO_SUBMITTED" ? "Time expired — auto-submitted" : "Submitted"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Your responses for &quot;{data.contest.title}&quot; have been recorded. Results will
            be shared by the admin.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!data.participant || !data.participant.contestStartedAt) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{data.contest.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.contest.description && (
            <p className="text-sm text-muted-foreground">{data.contest.description}</p>
          )}
          {data.contest.instructions && (
            <p className="whitespace-pre-wrap text-sm">{data.contest.instructions}</p>
          )}
          <p className="text-sm text-muted-foreground">
            {fmtIST(data.contest.startAt)} – {fmtIST(data.contest.endAt)} IST ·{" "}
            {data.contest.durationMinutes} minutes once started
          </p>
          {data.contest.phase === "UPCOMING" && (
            <p className="text-sm text-amber-600 dark:text-amber-400">
              This contest hasn&apos;t started yet.
            </p>
          )}
          {data.contest.phase === "ENDED" && (
            <p className="text-sm text-destructive">This contest window has ended.</p>
          )}
          <div>
            <Button
              onClick={handleStart}
              disabled={starting || data.contest.phase !== "ACTIVE"}
            >
              {starting ? "Starting…" : "Start contest"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!current) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          This contest has no questions.
        </CardContent>
      </Card>
    );
  }

  const a = answers[current.id] ?? defaultAnswer();
  const isLast = currentIndex === questions.length - 1;

  function goTo(i: number) {
    setCurrentIndex(Math.max(0, Math.min(questions.length - 1, i)));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-2">
          <span className="font-medium">{data.contest.title}</span>
          <span
            className={`font-mono text-lg tabular-nums ${
              (remaining ?? 0) < 60 ? "text-destructive" : ""
            }`}
          >
            {remaining !== null ? fmtClock(remaining) : "--:--:--"}
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Question {currentIndex + 1} of {questions.length}
              {current.sectionLabel ? ` · ${current.sectionLabel}` : ""} · {current.points} pts
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="whitespace-pre-wrap text-sm">{current.question.body}</p>

            {current.question.type === "MCQ" && (
              <div className="grid gap-2">
                {current.question.options.map((o) => (
                  <label
                    key={o.id}
                    className="flex items-center gap-2 rounded-md border p-2.5 text-sm"
                  >
                    <Checkbox
                      checked={a.selectedOptionIds.includes(o.id)}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...a.selectedOptionIds, o.id]
                          : a.selectedOptionIds.filter((id) => id !== o.id);
                        persist(current.id, { selectedOptionIds: next });
                      }}
                    />
                    {o.text}
                  </label>
                ))}
              </div>
            )}

            {current.question.type === "TEXT" && (
              <Input
                value={a.textAnswer ?? ""}
                onChange={(e) => debouncedSave(current.id, { textAnswer: e.target.value })}
                placeholder="Type your answer…"
              />
            )}

            {current.question.type === "CODING" && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Coding questions are answered from the code editor, coming in the next phase.
                Use Skip to move on.
              </p>
            )}

            <div className="flex flex-wrap gap-2 border-t pt-3">
              {current.question.type !== "CODING" && (
                <>
                  <Button
                    onClick={() => {
                      persist(current.id, { markedForReview: false });
                      if (!isLast) goTo(currentIndex + 1);
                    }}
                  >
                    Save &amp; Next
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      persist(current.id, { markedForReview: true });
                      if (!isLast) goTo(currentIndex + 1);
                    }}
                  >
                    Mark for Review &amp; Next
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      persist(current.id, { selectedOptionIds: [], textAnswer: null })
                    }
                  >
                    Clear Response
                  </Button>
                </>
              )}
              <Button variant="ghost" onClick={() => !isLast && goTo(currentIndex + 1)} disabled={isLast}>
                Skip
              </Button>
              <div className="flex-1" />
              <Button variant="destructive" onClick={() => setConfirmSubmitOpen(true)}>
                Submit contest
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardContent className="pt-4">
          <QuestionPalette
            questions={questions}
            answers={answers}
            currentIndex={currentIndex}
            onSelect={goTo}
          />
        </CardContent>
      </Card>

      <AlertDialog open={confirmSubmitOpen} onOpenChange={setConfirmSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit contest?</AlertDialogTitle>
            <AlertDialogDescription>
              You won&apos;t be able to change your answers after submitting. Unanswered
              questions will score zero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={() => {
                setConfirmSubmitOpen(false);
                handleSubmit(false);
              }}
            >
              Submit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
