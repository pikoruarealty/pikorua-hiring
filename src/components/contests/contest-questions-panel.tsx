"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContestQuestionRow } from "./types";
import type { QuestionListItem } from "@/components/questions/types";

export function ContestQuestionsPanel({
  contestId,
  questions,
  editable,
  onChanged,
}: {
  contestId: string;
  questions: ContestQuestionRow[];
  editable: boolean;
  onChanged: () => void;
}) {
  const ordered = [...questions].sort((a, b) => a.order - b.order);
  const attachedIds = new Set(questions.map((q) => q.question.id));

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QuestionListItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!editable) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ archived: "active", pageSize: "10" });
        if (query) params.set("query", query);
        const res = await apiFetch(`/api/admin/questions?${params}`);
        if (res.ok) {
          const body = await res.json();
          setResults(body.questions as QuestionListItem[]);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, editable]);

  async function attach(questionId: string) {
    const res = await apiFetch(`/api/admin/contests/${contestId}/questions`, {
      method: "POST",
      body: JSON.stringify({ questionId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not attach question");
      return;
    }
    toast.success("Question attached");
    onChanged();
  }

  async function detach(contestQuestionId: string) {
    const res = await apiFetch(
      `/api/admin/contests/${contestId}/questions?contestQuestionId=${contestQuestionId}`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not remove question");
      return;
    }
    onChanged();
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    const res = await apiFetch(`/api/admin/contests/${contestId}/questions`, {
      method: "PATCH",
      body: JSON.stringify({ order: next.map((q) => q.id) }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Could not reorder");
      return;
    }
    onChanged();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Questions ({ordered.length})</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {ordered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No questions attached yet.</p>
        ) : (
          <ul className="grid gap-2">
            {ordered.map((cq, i) => (
              <li key={cq.id} className="flex items-center gap-2 rounded-md border p-2">
                <Badge variant="outline">{cq.question.type}</Badge>
                <span className="flex-1 truncate text-sm font-medium">{cq.question.title}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {cq.pointsOverride ?? cq.question.defaultPoints} pts
                </span>
                {editable && (
                  <>
                    <Button variant="ghost" size="icon" onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => move(i, 1)}
                      disabled={i === ordered.length - 1}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => detach(cq.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {editable && (
          <div className="grid gap-2 border-t pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search question bank to attach…"
                className="pl-8"
              />
            </div>
            <ul className="grid gap-1">
              {searching && <li className="text-xs text-muted-foreground">Searching…</li>}
              {results
                .filter((r) => !attachedIds.has(r.id))
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-md border p-1.5 text-sm">
                    <Badge variant="outline">{r.type}</Badge>
                    <span className="flex-1 truncate">{r.title}</span>
                    <Button size="sm" variant="outline" onClick={() => attach(r.id)}>
                      <Plus className="size-3.5" /> Add
                    </Button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
