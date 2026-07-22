"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ParticipantDrilldown } from "./types";

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "SUBMITTED":
      return "default";
    case "AUTO_SUBMITTED":
      return "secondary";
    case "LOCKED_OUT":
      return "destructive";
    default:
      return "outline";
  }
}

export function ParticipantDrilldownDialog({
  contestId,
  contestParticipantId,
  onOpenChange,
}: {
  contestId: string;
  contestParticipantId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [data, setData] = useState<ParticipantDrilldown | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contestParticipantId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/admin/contests/${contestId}/results/${contestParticipantId}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          toast.error(body.error ?? "Could not load participant details");
          return;
        }
        setData(body as ParticipantDrilldown);
      })
      .catch(() => {
        if (!cancelled) toast.error("Network error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [contestId, contestParticipantId]);

  return (
    <Dialog open={!!contestParticipantId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data ? data.participant.user.fullName ?? data.participant.user.username : "Participant"}
          </DialogTitle>
          <DialogDescription>
            {data ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{data.participant.user.username}</span>
                {data.participant.user.email && <span>{data.participant.user.email}</span>}
                <Badge variant={statusVariant(data.participant.status)}>
                  {data.participant.status}
                </Badge>
                <span>
                  Score: {data.participant.totalScore}
                  {data.participant.tieBreakExecutionTimeMs != null &&
                    ` · ${data.participant.tieBreakExecutionTimeMs}ms`}
                </span>
              </span>
            ) : (
              "Loading participant details"
            )}
          </DialogDescription>
        </DialogHeader>

        {loading || !data ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-6">
            {data.participant.autoSubmittedReason && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Auto-submitted: {data.participant.autoSubmittedReason}
              </p>
            )}

            <div className="grid gap-4">
              <h3 className="font-heading text-sm font-medium">Answers</h3>
              {data.questions.map((q) => (
                <div key={q.contestQuestionId} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {q.order}. {q.question.title}
                    </span>
                    <Badge variant="outline">{q.question.type}</Badge>
                    {q.sectionLabel && <Badge variant="secondary">{q.sectionLabel}</Badge>}
                    {q.submit && (
                      <span className="text-sm text-muted-foreground">
                        Score: {q.submit.score ?? 0} / {q.submit.maxPossibleScore ?? 0}
                      </span>
                    )}
                  </div>

                  {!q.submit ? (
                    <p className="text-sm text-muted-foreground">Not attempted.</p>
                  ) : q.question.type === "MCQ" ? (
                    <ul className="grid gap-1 text-sm">
                      {q.question.options.map((opt) => {
                        const selected = q.submit!.selectedOptionIds.includes(opt.id);
                        return (
                          <li
                            key={opt.id}
                            className={
                              opt.isCorrect
                                ? "text-green-600 dark:text-green-400"
                                : selected
                                  ? "text-red-600 dark:text-red-400"
                                  : ""
                            }
                          >
                            {selected ? "☑" : "☐"} {opt.text}
                            {opt.isCorrect && " (correct)"}
                          </li>
                        );
                      })}
                    </ul>
                  ) : q.question.type === "TEXT" ? (
                    <div className="grid gap-1 text-sm">
                      <p>
                        <span className="text-muted-foreground">Submitted: </span>
                        {q.submit.textAnswer ?? <em>none</em>}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Correct: </span>
                        {q.question.correctAnswer ?? <em>none</em>}
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2 text-sm">
                      <p className="text-muted-foreground">
                        Language: {q.submit.language ?? "—"} · Total exec time:{" "}
                        {q.submit.totalExecutionTimeMs ?? "—"}ms
                      </p>
                      {q.submit.code && (
                        <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
                          {q.submit.code}
                        </pre>
                      )}
                      {q.submit.testCaseResults && q.submit.testCaseResults.length > 0 && (
                        <div className="overflow-x-auto rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Passed</TableHead>
                                <TableHead>Time (ms)</TableHead>
                                <TableHead>Actual output</TableHead>
                                <TableHead>Error</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {q.submit.testCaseResults.map((tc, i) => (
                                <TableRow key={tc.testCaseId}>
                                  <TableCell>{i + 1}</TableCell>
                                  <TableCell>{tc.isSample ? "Sample" : "Hidden"}</TableCell>
                                  <TableCell>
                                    <Badge variant={tc.passed ? "default" : "destructive"}>
                                      {tc.passed ? "Pass" : "Fail"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>{tc.executionTimeMs}</TableCell>
                                  <TableCell className="max-w-64 truncate font-mono text-xs">
                                    {tc.actualOutput}
                                  </TableCell>
                                  <TableCell className="max-w-48 truncate text-xs text-destructive">
                                    {tc.error ?? ""}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="grid gap-2">
              <h3 className="font-heading text-sm font-medium">Proctoring log</h3>
              {data.proctoringEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No proctoring events recorded.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Count</TableHead>
                        <TableHead>Action taken</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.proctoringEvents.map((ev) => (
                        <TableRow key={ev.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(ev.occurredAt).toLocaleString()}
                          </TableCell>
                          <TableCell>{ev.eventType}</TableCell>
                          <TableCell>{ev.cumulativeCountAtEvent}</TableCell>
                          <TableCell>{ev.actionTaken}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
