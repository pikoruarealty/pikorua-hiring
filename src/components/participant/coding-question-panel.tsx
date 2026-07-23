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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
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
    answer.coding?.submit?.code ?? answer.coding?.run?.code ?? starter[language] ?? "",
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
  const [activeTab, setActiveTab] = useState("description");

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
        // The final event always carries the full, correctly-ordered results
        // (from the worker directly, or from the DB when the client
        // subscribed after the job had already finished) — always use it
        // over whatever partial set was accumulated via "test-result" events.
        if (data.results) setLiveResults(data.results);
        setActiveTab("result");
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
      onAnswerChange({ visited: true });
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
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          value={language}
          onValueChange={(v) => {
            setLanguage(v);
            if (!code.trim()) setCode(starter[v] ?? "");
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
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {language === "java" && (
            <span className="text-amber-600 dark:text-amber-400">
              Your public class must be named <code className="font-mono">Main</code>
            </span>
          )}
          <span>
            Limits: {coding.timeLimitSeconds}s / {coding.memoryLimitMb}MB per test
          </span>
          {remainingLock !== null && (
            <span className={remainingLock < 30 ? "font-mono text-destructive" : "font-mono"}>
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

      <ResizablePanelGroup
        orientation="horizontal"
        className="min-h-[560px] rounded-md border"
      >
        <ResizablePanel defaultSize="38" minSize="25" className="flex min-h-0 flex-col">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full min-h-0 flex-col gap-0">
            <TabsList className="m-2 self-start">
              <TabsTrigger value="description">Description</TabsTrigger>
              <TabsTrigger value="testcases">Testcases</TabsTrigger>
              <TabsTrigger value="result">
                Result
                {liveFinal && (
                  <Badge
                    variant={liveFinal.status === "PASSED" ? "default" : "secondary"}
                    className="ml-1.5"
                  >
                    {liveFinal.status}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="description" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <p className="whitespace-pre-wrap text-sm">{cq.question.body}</p>
            </TabsContent>

            <TabsContent value="testcases" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {coding.sampleTestCases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sample test cases for this question.</p>
              ) : (
                <div className="grid gap-2">
                  {coding.sampleTestCases.map((tc, i) => (
                    <div key={tc.id} className="grid gap-1 rounded-md border p-2 text-xs">
                      <span className="font-medium text-muted-foreground">Sample {i + 1}</span>
                      <div className="grid gap-1 sm:grid-cols-2">
                        <div>
                          <div className="text-muted-foreground">Input</div>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-2">
                            {tc.input}
                          </pre>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Expected output</div>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted/40 p-2">
                            {tc.expectedOutput}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="result" className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {!liveFinal && results.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Run or submit your code to see test results here.
                </p>
              ) : (
                <div className="grid gap-3">
                  {liveFinal && (
                    <div className="flex items-center gap-2">
                      <Badge variant={liveFinal.status === "PASSED" ? "default" : "secondary"}>
                        {liveFinal.status}
                        {liveFinal.score != null ? ` · ${liveFinal.score}/${liveFinal.maxScore}` : ""}
                      </Badge>
                    </div>
                  )}
                  {liveFinal?.compileError && (
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">
                      {liveFinal.compileError}
                    </pre>
                  )}
                  {sampleResults.map((r, i) => (
                    <ResultCard
                      key={r.testCaseId ?? i}
                      r={r}
                      expectedOutput={expectedByTestCaseId[r.testCaseId]}
                    />
                  ))}
                  {hiddenResults.length > 0 && <HiddenResultsSummary results={hiddenResults} />}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize="62" minSize="35" className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1">
            <CodeEditor language={language} value={code} onChange={setCode} readOnly={questionLocked} />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t p-2">
            <Button variant="secondary" onClick={handleRun} disabled={disabled}>
              {running ? <Loader2 className="size-4 animate-spin" /> : null} Run
            </Button>
            <Button onClick={handleSubmitCode} disabled={disabled}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null} Submit code
            </Button>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
