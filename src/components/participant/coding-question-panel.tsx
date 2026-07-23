"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CodeEditor } from "./monaco-editor";
import type { AnswerState, ParticipantQuestion, TestCaseResultView } from "./types";

const LANGUAGE_LABELS: Record<string, string> = { c: "C", cpp: "C++", java: "Java", python: "Python" };

function fmtClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Per-line mismatch flags between two blocks of text, for a leetcode-style diff. */
function diffLineFlags(a: string, b: string): boolean[] {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const len = Math.max(linesA.length, linesB.length);
  const flags: boolean[] = [];
  for (let i = 0; i < len; i++) flags.push((linesA[i] ?? "") !== (linesB[i] ?? ""));
  return flags;
}

function OutputBlock({
  text,
  mismatchFlags,
  variant,
}: {
  text: string;
  mismatchFlags?: boolean[];
  variant: "actual" | "expected";
}) {
  const lines = text.split("\n");
  return (
    <pre className="overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs">
      {lines.map((line, i) => (
        <div
          key={i}
          className={
            mismatchFlags?.[i]
              ? variant === "actual"
                ? "bg-destructive/20 text-destructive"
                : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
              : undefined
          }
        >
          {line === "" ? " " : line}
        </div>
      ))}
    </pre>
  );
}

function ResultCard({ r, expectedOutput }: { r: TestCaseResultView; expectedOutput?: string }) {
  const showOutputs = r.isSample && r.actualOutput !== undefined;
  const showDiff = showOutputs && !r.passed && expectedOutput !== undefined;
  const flags = showDiff ? diffLineFlags(r.actualOutput ?? "", expectedOutput ?? "") : undefined;

  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2">
        {r.passed ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : (
          <XCircle className="size-4 shrink-0 text-destructive" />
        )}
        <span className="font-medium">Sample test</span>
        {r.timedOut && <Badge variant="destructive">Time limit exceeded</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">{r.executionTimeMs}ms</span>
      </div>

      {showOutputs && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Your output</div>
            <OutputBlock text={r.actualOutput || "(empty)"} mismatchFlags={flags} variant="actual" />
          </div>
          {expectedOutput !== undefined && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Expected output</div>
              <OutputBlock text={expectedOutput} mismatchFlags={flags} variant="expected" />
            </div>
          )}
        </div>
      )}

      {r.error && (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-destructive/10 p-2 font-mono text-xs text-destructive">
          {r.error}
        </pre>
      )}
    </div>
  );
}

/** Hidden/private test cases never show a diff or per-case card — only an aggregate summary. */
function HiddenResultsSummary({ results }: { results: TestCaseResultView[] }) {
  const failed = results.filter((r) => !r.passed).length;
  const allPassed = failed === 0;

  return (
    <div className="grid gap-2 rounded-md border p-3 text-sm">
      <div className="flex items-center gap-2">
        {allPassed ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
        ) : (
          <XCircle className="size-4 shrink-0 text-destructive" />
        )}
        <span className="font-medium">
          {allPassed
            ? `All ${results.length} private test case${results.length === 1 ? "" : "s"} passed`
            : "Some private test cases have failed"}
        </span>
      </div>
    </div>
  );
}

export function CodingQuestionPanel({
  contestId,
  cq,
  answer,
  onAnswerChange,
  locked,
}: {
  contestId: string;
  cq: ParticipantQuestion;
  answer: AnswerState;
  onAnswerChange: (patch: Partial<AnswerState>) => void;
  locked: boolean;
}) {
  const coding = cq.question.coding!;
  const allowedLanguages = coding.allowedLanguages.length > 0 ? coding.allowedLanguages : ["python"];
  const starter = (coding.starterCode ?? {}) as Record<string, string>;
  const expectedByTestCaseId = Object.fromEntries(
    coding.sampleTestCases.map((tc) => [tc.id, tc.expectedOutput]),
  );

  const [language, setLanguage] = useState(answer.coding?.submit?.language ?? allowedLanguages[0]);
  const [code, setCode] = useState(
    answer.coding?.localCode ?? answer.coding?.submit?.code ?? answer.coding?.run?.code ?? starter[language] ?? "",
  );
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [liveResults, setLiveResults] = useState<TestCaseResultView[] | null>(null);
  const [liveFinal, setLiveFinal] = useState<{
    status: string;
    score?: number;
    maxScore?: number;
    compileError?: string | null;
  } | null>(null);
  const [remainingLock, setRemainingLock] = useState<number | null>(null);

  const lastSubmittedCode = answer.coding?.submit?.code ?? "";
  const hasEverSubmitted = !!lastSubmittedCode;
  const isCodeDirty = code.trim() !== lastSubmittedCode.trim() && (hasEverSubmitted || code.trim() !== "");

  const handleCodeChange = (newCode: string) => {
    setCode(newCode);
    onAnswerChange({
      coding: {
        run: answer.coding?.run ?? null,
        submit: answer.coding?.submit ?? null,
        localCode: newCode,
      },
    });
  };

  const esRef = useRef<EventSource | null>(null);

  // Visit once on mount — starts this question's hard-lock clock server-side.
  useEffect(() => {
    apiFetch(`/api/participant/contests/${contestId}/questions/${cq.id}/visit`, { method: "POST" }).catch(
      () => {},
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cq.id]);

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  useEffect(() => {
    if (!coding.hardLockDeadline) {
      setRemainingLock(null);
      return;
    }
    const deadline = new Date(coding.hardLockDeadline).getTime();
    const tick = () => setRemainingLock(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [coding.hardLockDeadline]);

  const questionLocked = locked || (remainingLock !== null && remainingLock <= 0);

  function subscribe(attemptId: string, kind: "run" | "submit") {
    esRef.current?.close();
    setLiveResults([]);
    setLiveFinal(null);
    const es = new EventSource(
      `/api/participant/contests/${contestId}/questions/${cq.id}/stream?attemptId=${attemptId}`,
    );
    esRef.current = es;
    es.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === "test-result") {
        setLiveResults((prev) => [...(prev ?? []), data.result]);
      } else if (data.type === "final") {
        setLiveFinal({ status: data.status, score: data.score, maxScore: data.maxScore, compileError: data.compileError });
        // The worker's own "final" event never includes `results` (test cases
        // stream incrementally via "test-result" events instead); only the
        // "already terminal at subscribe time" server-side final message
        // populates it. Only overwrite when present, so we don't clobber the
        // results already accumulated via "test-result" events with a stale
        // closure value.
        if (data.results) setLiveResults(data.results);
        if (kind === "run") setRunning(false);
        else setSubmitting(false);
        es.close();
      }
    };
    es.onerror = () => {
      es.close();
      setRunning(false);
      setSubmitting(false);
      toast.error("Lost connection while grading — try running again.");
    };
  }

  async function handleRun() {
    setRunning(true);
    setLiveResults(null);
    setLiveFinal(null);
    try {
      const res = await apiFetch(`/api/participant/contests/${contestId}/questions/${cq.id}/run`, {
        method: "POST",
        body: JSON.stringify({ language, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Run failed");
        setRunning(false);
        return;
      }
      subscribe(body.attemptId, "run");
    } catch {
      toast.error("Network error");
      setRunning(false);
    }
  }

  async function handleSubmitCode() {
    setSubmitting(true);
    setLiveResults(null);
    setLiveFinal(null);
    try {
      const res = await apiFetch(`/api/participant/contests/${contestId}/questions/${cq.id}/submit`, {
        method: "POST",
        body: JSON.stringify({ language, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Submit failed");
        setSubmitting(false);
        return;
      }
      onAnswerChange({
        visited: true,
        coding: {
          run: answer.coding?.run ?? null,
          submit: {
            language,
            code,
            status: "PENDING",
            totalExecutionTimeMs: null,
            results: [],
            score: null,
            maxScore: null,
          },
          localCode: code,
        },
      });
      subscribe(body.attemptId, "submit");
      toast.success("Code submitted for grading");
    } catch {
      toast.error("Network error");
      setSubmitting(false);
    }
  }

  const results = liveResults ?? answer.coding?.submit?.results ?? answer.coding?.run?.results ?? [];
  const sampleResults = results.filter((r) => r.isSample);
  const hiddenResults = results.filter((r) => !r.isSample);
  const disabled = questionLocked || running || submitting;

  return (
    <div className="space-y-6">
      {/* 1. Question Details */}
      <div className="space-y-2 border-b pb-4">
        <h2 className="text-xl font-bold text-foreground">{cq.question.title}</h2>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{cq.question.body}</p>
      </div>

      {/* 2. Read-only Sample Test Cases */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Sample Test Cases</h3>
        {coding.sampleTestCases.length === 0 ? (
          <p className="text-xs text-muted-foreground bg-muted/10 border rounded-md p-3">
            No sample test cases provided.
          </p>
        ) : (
          <div className="grid gap-3">
            {coding.sampleTestCases.map((tc, i) => (
              <div key={tc.id} className="grid gap-2 rounded-md border p-3 text-xs bg-muted/20">
                <span className="font-semibold text-foreground">Sample {i + 1}</span>
                <div className="grid gap-2 sm:grid-cols-2 mt-1">
                  <div>
                    <div className="font-medium text-muted-foreground mb-1">Input</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded border bg-background p-2 font-mono">
                      {tc.input || "(empty)"}
                    </pre>
                  </div>
                  <div>
                    <div className="font-medium text-muted-foreground mb-1">Expected Output</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded border bg-background p-2 font-mono">
                      {tc.expectedOutput}
                    </pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Language Picker & Monaco Code Editor */}
      <div className="space-y-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Language:</span>
            <Select
              value={language}
              onValueChange={(v) => {
                setLanguage(v);
                const nextCode = !code.trim() ? (starter[v] ?? "") : code;
                if (!code.trim()) setCode(nextCode);
                onAnswerChange({
                  coding: {
                    run: answer.coding?.run ?? null,
                    submit: answer.coding?.submit ?? null,
                    localCode: nextCode,
                  },
                });
              }}
              disabled={disabled}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedLanguages.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LANGUAGE_LABELS[l] ?? l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {language === "java" && (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                Your public class must be named <code className="font-mono">Main</code>
              </span>
            )}
            <span>
              Limits: {coding.timeLimitSeconds}s / {coding.memoryLimitMb}MB per test
            </span>
            {remainingLock !== null && (
              <span className={remainingLock < 30 ? "font-mono text-destructive font-semibold" : "font-mono"}>
                Locks in {fmtClock(remainingLock)}
              </span>
            )}
          </div>
        </div>

        {questionLocked && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            This question&apos;s time limit has expired — Run/Submit are disabled.
          </p>
        )}

        {/* Warning/Success Status Banner */}
        {!questionLocked && (
          isCodeDirty ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <span className="font-semibold">⚠️ Unsubmitted changes:</span>
              <span>Your current code is different from your last submitted version. Click &quot;Submit code&quot; below to save and grade it.</span>
            </div>
          ) : hasEverSubmitted ? (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
              <span className="font-semibold">✅ Code submitted:</span>
              <span>Your latest code matches the submitted version and is saved for grading.</span>
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400 flex items-center gap-2">
              <span className="font-semibold">⚠️ Code not submitted:</span>
              <span>You have not submitted a solution for this question yet. Click &quot;Submit code&quot; below when ready.</span>
            </div>
          )
        )}

        <div className="rounded-md border overflow-hidden h-[450px]">
          <CodeEditor language={language} value={code} onChange={handleCodeChange} readOnly={questionLocked} />
        </div>
      </div>

      {/* 4. Action Buttons (Run and Submit) */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={handleRun} disabled={disabled} size="lg">
          {running ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Run
        </Button>
        <Button onClick={handleSubmitCode} disabled={disabled} size="lg">
          {submitting ? <Loader2 className="size-4 animate-spin mr-2" /> : null} Submit code
        </Button>
      </div>

      {/* 5. Execution Results */}
      <div className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          Execution Results
          {liveFinal && (
            <Badge
              variant={liveFinal.status === "PASSED" ? "default" : "secondary"}
              className="ml-1.5"
            >
              {liveFinal.status}
            </Badge>
          )}
        </h3>

        {!liveFinal && results.length === 0 ? (
          <p className="text-xs text-muted-foreground bg-muted/10 border rounded-md p-3">
            Run or submit your code to see the grading output here.
          </p>
        ) : (
          <div className="grid gap-3">
            {liveFinal && (
              <div className="flex items-center gap-2">
                <Badge variant={liveFinal.status === "PASSED" ? "default" : "secondary"} className="text-xs">
                  {liveFinal.status}
                  {liveFinal.score != null ? ` · ${liveFinal.score}/${liveFinal.maxScore}` : ""}
                </Badge>
              </div>
            )}
            {liveFinal?.compileError && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-destructive">Compilation Error</div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-destructive/20 bg-destructive/5 p-3 font-mono text-xs text-destructive">
                  {liveFinal.compileError}
                </pre>
              </div>
            )}
            {sampleResults.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground">Sample Test Cases</div>
                {sampleResults.map((r, i) => (
                  <ResultCard
                    key={r.testCaseId ?? i}
                    r={r}
                    expectedOutput={expectedByTestCaseId[r.testCaseId]}
                  />
                ))}
              </div>
            )}
            {hiddenResults.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground">Private Test Cases</div>
                <HiddenResultsSummary results={hiddenResults} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
