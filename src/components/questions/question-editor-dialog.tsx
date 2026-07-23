"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from "@/lib/languages";
import type {
  QuestionDetail,
  QuestionType,
  OptionRow,
  TestCaseRow,
} from "./types";

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;
const CONTENT_TAB_LABEL: Record<QuestionType, string> = {
  MCQ: "Options",
  TEXT: "Answer",
  CODING: "Config & test cases",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: QuestionDetail | null;
  onSaved: () => void;
}

export function QuestionEditorDialog({ open, onOpenChange, editing, onSaved }: Props) {
  const [tab, setTab] = useState("details");
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState<QuestionType>("MCQ");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [difficulty, setDifficulty] = useState<string>("");
  const [tags, setTags] = useState("");
  const [defaultPoints, setDefaultPoints] = useState("10");

  const [options, setOptions] = useState<OptionRow[]>([
    { text: "", score: 1, order: 0, isCorrect: true },
    { text: "", score: 0, order: 1, isCorrect: false },
  ]);
  const [allowMultipleAnswers, setAllowMultipleAnswers] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState("");

  const [timeLimitSeconds, setTimeLimitSeconds] = useState(2);
  const [memoryLimitMb, setMemoryLimitMb] = useState(256);
  const [allowedLanguages, setAllowedLanguages] = useState<string[]>(["python"]);
  const [hardLock, setHardLock] = useState("");
  const [testCases, setTestCases] = useState<TestCaseRow[]>([
    { input: "", expectedOutput: "", isSample: true, score: 10, order: 0 },
  ]);

  useEffect(() => {
    if (!open) return;
    setTab("details");
    if (editing) {
      setType(editing.type);
      setTitle(editing.title);
      setBody(editing.body);
      setDifficulty(editing.difficulty ?? "");
      setTags(editing.tags.join(", "));
      setDefaultPoints(editing.defaultPoints);
      if (editing.type === "MCQ") {
        setOptions(editing.options);
        setAllowMultipleAnswers(editing.allowMultipleAnswers);
      }
      if (editing.type === "TEXT")
        setCorrectAnswer(editing.textAnswerConfig?.correctAnswer ?? "");
      if (editing.type === "CODING" && editing.codingConfig) {
        setTimeLimitSeconds(editing.codingConfig.timeLimitSeconds);
        setMemoryLimitMb(editing.codingConfig.memoryLimitMb);
        setAllowedLanguages(editing.codingConfig.allowedLanguages);
        setHardLock(
          editing.codingConfig.defaultHardLockSeconds != null
            ? String(editing.codingConfig.defaultHardLockSeconds)
            : "",
        );
        setTestCases(editing.codingConfig.testCases);
      }
    } else {
      setType("MCQ");
      setTitle("");
      setBody("");
      setDifficulty("");
      setTags("");
      setDefaultPoints("10");
      setOptions([
        { text: "", score: 1, order: 0, isCorrect: true },
        { text: "", score: 0, order: 1, isCorrect: false },
      ]);
      setAllowMultipleAnswers(false);
      setCorrectAnswer("");
      setTimeLimitSeconds(2);
      setMemoryLimitMb(256);
      setAllowedLanguages(["python"]);
      setHardLock("");
      setTestCases([{ input: "", expectedOutput: "", isSample: true, score: 10, order: 0 }]);
    }
  }, [open, editing]);

  function toggleLanguage(lang: string) {
    setAllowedLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const base = {
      title,
      body,
      difficulty: difficulty || undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    };

    let payload: Record<string, unknown>;
    if (type === "MCQ") {
      payload = { type, ...base, defaultPoints: Number(defaultPoints), allowMultipleAnswers, options };
    } else if (type === "TEXT") {
      payload = { type, ...base, defaultPoints: Number(defaultPoints), correctAnswer };
    } else {
      payload = {
        type,
        ...base,
        codingConfig: {
          timeLimitSeconds,
          memoryLimitMb,
          allowedLanguages,
          defaultHardLockSeconds: hardLock ? Number(hardLock) : undefined,
        },
        testCases,
      };
    }

    setSubmitting(true);
    try {
      const url = editing ? `/api/admin/questions/${editing.id}` : "/api/admin/questions";
      const res = await apiFetch(url, {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not save question");
        return;
      }
      toast.success(editing ? "Question updated" : "Question created");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>{editing ? "Edit question" : "New question"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "A question's type can't be changed after creation."
                : "Choose a type, fill in the basics, then switch tabs for the type-specific content."}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-0">
            <div className="px-5 pt-3">
              <TabsList className="w-full">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="content">{CONTENT_TAB_LABEL[type]}</TabsTrigger>
              </TabsList>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <TabsContent value="details" className="grid gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>Type</Label>
                    <Select
                      value={type}
                      onValueChange={(v) => setType(v as QuestionType)}
                      disabled={!!editing}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MCQ">MCQ</SelectItem>
                        <SelectItem value="TEXT">Text answer</SelectItem>
                        <SelectItem value="CODING">Coding</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Difficulty</Label>
                    <Select
                      value={difficulty || "none"}
                      onValueChange={(v) => setDifficulty(v === "none" ? "" : v)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Unset" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unset</SelectItem>
                        {DIFFICULTIES.map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="q-title">
                    Title <span className="text-destructive">*</span>
                  </Label>
                  <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="q-body">
                    Prompt <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="q-body"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={5}
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="q-tags">Tags</Label>
                    <Input
                      id="q-tags"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      placeholder="arrays, easy, sql…"
                    />
                    <p className="text-xs text-muted-foreground">Comma-separated.</p>
                  </div>
                  {type !== "CODING" ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor="q-points">Points</Label>
                      <Input
                        id="q-points"
                        type="number"
                        min={0}
                        step="0.5"
                        value={defaultPoints}
                        onChange={(e) => setDefaultPoints(e.target.value)}
                        required
                      />
                    </div>
                  ) : (
                    <div className="grid gap-1.5">
                      <Label>Points</Label>
                      <p className="flex h-9 items-center text-sm text-muted-foreground">
                        Sum of test-case scores — set on the {CONTENT_TAB_LABEL.CODING} tab.
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="content">
                {type === "MCQ" && (
                  <OptionsEditor
                    options={options}
                    onChange={setOptions}
                    allowMultipleAnswers={allowMultipleAnswers}
                    onAllowMultipleAnswersChange={setAllowMultipleAnswers}
                  />
                )}
                {type === "TEXT" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="q-answer">
                      Correct answer <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="q-answer"
                      value={correctAnswer}
                      onChange={(e) => setCorrectAnswer(e.target.value)}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Matching is case-insensitive and trimmed.
                    </p>
                  </div>
                )}
                {type === "CODING" && (
                  <CodingEditor
                    timeLimitSeconds={timeLimitSeconds}
                    setTimeLimitSeconds={setTimeLimitSeconds}
                    memoryLimitMb={memoryLimitMb}
                    setMemoryLimitMb={setMemoryLimitMb}
                    allowedLanguages={allowedLanguages}
                    toggleLanguage={toggleLanguage}
                    hardLock={hardLock}
                    setHardLock={setHardLock}
                    testCases={testCases}
                    onChange={setTestCases}
                  />
                )}
              </TabsContent>
            </div>
          </Tabs>

          <DialogFooter className="mx-0 mb-0 rounded-b-xl">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : editing ? "Save changes" : "Create question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OptionsEditor({
  options,
  onChange,
  allowMultipleAnswers,
  onAllowMultipleAnswersChange,
}: {
  options: OptionRow[];
  onChange: (o: OptionRow[]) => void;
  allowMultipleAnswers: boolean;
  onAllowMultipleAnswersChange: (v: boolean) => void;
}) {
  function update(i: number, patch: Partial<OptionRow>) {
    if (!allowMultipleAnswers && patch.isCorrect === true) {
      // Single-answer mode behaves like a radio group: marking one option
      // correct clears every other option's correct flag and score.
      onChange(
        options.map((o, idx) =>
          idx === i ? { ...o, ...patch } : { ...o, isCorrect: false, score: 0 },
        ),
      );
      return;
    }
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  function add() {
    onChange([...options, { text: "", score: 0, order: options.length, isCorrect: false }]);
  }
  function remove(i: number) {
    onChange(options.filter((_, idx) => idx !== i));
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <div>
          <Label>Options</Label>
          <p className="text-xs text-muted-foreground">
            At least 2. Final score = sum of selected options&apos; scores, floored at 0.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="size-3.5" /> Add option
        </Button>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs text-muted-foreground">Answer selection</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={!allowMultipleAnswers ? "default" : "outline"}
            onClick={() => onAllowMultipleAnswersChange(false)}
          >
            Single answer (radio)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={allowMultipleAnswers ? "default" : "outline"}
            onClick={() => onAllowMultipleAnswersChange(true)}
          >
            Multiple answers (checkbox)
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {options.map((o, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg border bg-card p-2.5">
            <Checkbox
              checked={o.isCorrect}
              onCheckedChange={(c) => update(i, { isCorrect: c === true })}
              aria-label="Marked correct"
            />
            <Input
              className="flex-1"
              placeholder={`Option ${i + 1} text`}
              value={o.text}
              onChange={(e) => update(i, { text: e.target.value })}
              required
            />
            <Input
              className="w-20 shrink-0"
              type="number"
              step="0.5"
              placeholder="Score"
              value={o.score}
              onChange={(e) => update(i, { score: Number(e.target.value) })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(i)}
              disabled={options.length <= 2}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function CodingEditor({
  timeLimitSeconds,
  setTimeLimitSeconds,
  memoryLimitMb,
  setMemoryLimitMb,
  allowedLanguages,
  toggleLanguage,
  hardLock,
  setHardLock,
  testCases,
  onChange,
}: {
  timeLimitSeconds: number;
  setTimeLimitSeconds: (n: number) => void;
  memoryLimitMb: number;
  setMemoryLimitMb: (n: number) => void;
  allowedLanguages: string[];
  toggleLanguage: (l: string) => void;
  hardLock: string;
  setHardLock: (v: string) => void;
  testCases: TestCaseRow[];
  onChange: (t: TestCaseRow[]) => void;
}) {
  function update(i: number, patch: Partial<TestCaseRow>) {
    onChange(testCases.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function add() {
    onChange([
      ...testCases,
      { input: "", expectedOutput: "", isSample: false, score: 5, order: testCases.length },
    ]);
  }
  function remove(i: number) {
    onChange(testCases.filter((_, idx) => idx !== i));
  }
  const total = testCases.reduce((a, t) => a + (Number(t.score) || 0), 0);

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 rounded-lg border bg-card p-3.5">
        <p className="text-sm font-medium">Execution limits</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Time limit (1–15s)</Label>
            <Input
              type="number"
              min={1}
              max={15}
              value={timeLimitSeconds}
              onChange={(e) => setTimeLimitSeconds(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Memory (16–512MB)</Label>
            <Input
              type="number"
              min={16}
              max={512}
              value={memoryLimitMb}
              onChange={(e) => setMemoryLimitMb(Number(e.target.value))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Question time limit (s)</Label>
            <Input
              type="number"
              min={30}
              placeholder="No limit"
              value={hardLock}
              onChange={(e) => setHardLock(e.target.value)}
            />
          </div>
        </div>
        <Separator />
        <div className="grid gap-1.5">
          <Label className="text-xs text-muted-foreground">Allowed languages</Label>
          <div className="flex flex-wrap gap-3">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <label key={lang} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={allowedLanguages.includes(lang)}
                  onCheckedChange={() => toggleLanguage(lang)}
                />
                {LANGUAGE_LABELS[lang]}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        <div className="flex items-center justify-between">
          <div>
            <Label>Test cases</Label>
            <p className="text-xs text-muted-foreground">
              At least 1, and at least 1 marked sample — total {total} pts.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="size-3.5" /> Add test case
          </Button>
        </div>
        <div className="grid gap-2">
          {testCases.map((t, i) => (
            <div key={i} className="grid gap-2 rounded-lg border bg-card p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">stdin</Label>
                  <Textarea
                    value={t.input}
                    onChange={(e) => update(i, { input: e.target.value })}
                    rows={2}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="text-xs text-muted-foreground">expected stdout</Label>
                  <Textarea
                    value={t.expectedOutput}
                    onChange={(e) => update(i, { expectedOutput: e.target.value })}
                    rows={2}
                    className="font-mono text-xs"
                    required
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={t.isSample}
                    onCheckedChange={(c) => update(i, { isSample: c === true })}
                  />
                  Sample (visible / used by Run)
                </label>
                <Input
                  className="w-20"
                  type="number"
                  min={0}
                  step="0.5"
                  placeholder="Score"
                  value={t.score}
                  onChange={(e) => update(i, { score: Number(e.target.value) })}
                />
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(i)}
                  disabled={testCases.length <= 1}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
