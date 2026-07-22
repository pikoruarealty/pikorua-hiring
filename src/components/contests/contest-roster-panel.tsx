"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RosterEntry } from "./types";

interface ParticipantResult {
  id: string;
  username: string;
  fullName: string | null;
}

export function ContestRosterPanel({
  contestId,
  editable,
}: {
  contestId: string;
  editable: boolean;
}) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ParticipantResult[]>([]);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/contests/${contestId}/participants?pageSize=200`);
      if (res.ok) {
        const body = await res.json();
        setRoster(body.roster as RosterEntry[]);
      }
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => {
    loadRoster();
  }, [loadRoster]);

  useEffect(() => {
    if (!editable) return;
    const t = setTimeout(async () => {
      const params = new URLSearchParams({ pageSize: "10", active: "active" });
      if (query) params.set("query", query);
      const res = await apiFetch(`/api/admin/participants?${params}`);
      if (res.ok) {
        const body = await res.json();
        setResults(body.participants as ParticipantResult[]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, editable]);

  async function invite(userId: string) {
    const res = await apiFetch(`/api/admin/contests/${contestId}/participants`, {
      method: "POST",
      body: JSON.stringify({ userIds: [userId] }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not invite participant");
      return;
    }
    toast.success("Invited");
    loadRoster();
  }

  async function remove(userId: string) {
    const res = await apiFetch(
      `/api/admin/contests/${contestId}/participants?userId=${userId}`,
      { method: "DELETE" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "Could not remove participant");
      return;
    }
    loadRoster();
  }

  const rosterIds = new Set(roster.map((r) => r.user.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster ({roster.length})</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No participants invited yet.</p>
        ) : (
          <ul className="grid max-h-64 gap-1 overflow-y-auto">
            {roster.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-md border p-1.5 text-sm">
                <span className="font-mono">{r.user.username}</span>
                <span className="flex-1 truncate text-muted-foreground">{r.user.fullName}</span>
                <Badge variant="outline">{r.status}</Badge>
                {editable && (
                  <Button variant="ghost" size="icon" onClick={() => remove(r.user.id)}>
                    <Trash2 className="size-4" />
                  </Button>
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
                placeholder="Search participants to invite…"
                className="pl-8"
              />
            </div>
            <ul className="grid gap-1">
              {results
                .filter((r) => !rosterIds.has(r.id))
                .map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-md border p-1.5 text-sm">
                    <span className="font-mono">{r.username}</span>
                    <span className="flex-1 truncate text-muted-foreground">{r.fullName}</span>
                    <Button size="sm" variant="outline" onClick={() => invite(r.id)}>
                      <Plus className="size-3.5" /> Invite
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
