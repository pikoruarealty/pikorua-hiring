"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Save, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContestQuestionsPanel } from "./contest-questions-panel";
import { ContestRosterPanel } from "./contest-roster-panel";
import type { ContestDetail } from "./types";

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ContestDetailClient({ contestId }: { contestId: string }) {
  const [contest, setContest] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<{
    title: string;
    description: string;
    instructions: string;
    visibility: "INVITE_ONLY" | "OPEN";
    startAt: string;
    endAt: string;
    durationMinutes: number;
    resultsVisibleToParticipants: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/contests/${contestId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not load contest");
        return;
      }
      const c = body.contest as ContestDetail;
      setContest(c);
      setForm({
        title: c.title,
        description: c.description ?? "",
        instructions: c.instructions ?? "",
        visibility: c.visibility,
        startAt: toLocalInput(c.startAt),
        endAt: toLocalInput(c.endAt),
        durationMinutes: c.durationMinutes,
        resultsVisibleToParticipants: c.resultsVisibleToParticipants,
      });
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveDetails() {
    if (!form) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/admin/contests/${contestId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: form.title,
          description: form.description || undefined,
          instructions: form.instructions || undefined,
          visibility: form.visibility,
          startAt: new Date(form.startAt).toISOString(),
          endAt: new Date(form.endAt).toISOString(),
          durationMinutes: form.durationMinutes,
          resultsVisibleToParticipants: form.resultsVisibleToParticipants,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not save contest");
        return;
      }
      toast.success("Contest saved");
      load();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    const res = await apiFetch(`/api/admin/contests/${contestId}/publish`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not publish contest");
      return;
    }
    toast.success("Contest published");
    load();
  }

  async function unpublish() {
    const res = await apiFetch(`/api/admin/contests/${contestId}/unpublish`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not unpublish contest");
      return;
    }
    toast.success("Contest moved back to draft");
    load();
  }

  if (loading || !contest || !form) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const editable = !contest.locked;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/admin/contests">
            <ArrowLeft className="size-4" /> Contests
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{contest.title}</h1>
        <Badge variant="secondary">{contest.status}</Badge>
        {contest.locked && <Badge variant="outline">In progress — locked</Badge>}
        <div className="flex-1" />
        {contest.status === "DRAFT" && (
          <Button onClick={publish}>
            <Send className="size-4" /> Publish
          </Button>
        )}
        {contest.status === "SCHEDULED" && !contest.locked && (
          <Button variant="outline" onClick={unpublish}>
            <Undo2 className="size-4" /> Unpublish
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!editable && (
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              A participant has already entered this contest, so its details, questions, and
              roster are locked to protect their in-progress attempt.
            </p>
          )}
          <div className="grid gap-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              disabled={!editable}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              disabled={!editable}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Instructions</Label>
            <Textarea
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              rows={2}
              disabled={!editable}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Start (IST)</Label>
              <Input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                disabled={!editable}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>End (IST)</Label>
              <Input
                type="datetime-local"
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                disabled={!editable}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Duration (minutes)</Label>
              <Input
                type="number"
                min={1}
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
                disabled={!editable}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Visibility</Label>
              <Select
                value={form.visibility}
                onValueChange={(v) => setForm({ ...form, visibility: v as typeof form.visibility })}
                disabled={!editable}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INVITE_ONLY">Invite only</SelectItem>
                  <SelectItem value="OPEN">Open to all</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={form.resultsVisibleToParticipants}
              onCheckedChange={(v) => setForm({ ...form, resultsVisibleToParticipants: v })}
              disabled={!editable}
            />
            Show results to participants after the contest ends
          </label>
          {editable && (
            <div>
              <Button onClick={saveDetails} disabled={saving}>
                <Save className="size-4" /> {saving ? "Saving…" : "Save details"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <ContestQuestionsPanel
          contestId={contestId}
          questions={contest.contestQuestions}
          editable={editable}
          onChanged={load}
        />
        {contest.visibility === "INVITE_ONLY" ? (
          <ContestRosterPanel contestId={contestId} editable={editable} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Roster</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This contest is open to all registered participants — no explicit invite list is
                needed.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
