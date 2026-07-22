"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LeaderboardRow } from "./types";
import { ParticipantDrilldownDialog } from "./participant-drilldown-dialog";
import { ShortlistDialog } from "./shortlist-dialog";

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

/** Trigger a browser download of a blob, honoring the server filename. */
function downloadBlob(blob: Blob, disposition: string | null) {
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? "results";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ContestResultsPanel({ contestId }: { contestId: string }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [openParticipant, setOpenParticipant] = useState<string | null>(null);
  const [shortlistOpen, setShortlistOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/admin/contests/${contestId}/results`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not load results");
        return;
      }
      setRows(body.leaderboard as LeaderboardRow[]);
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }, [contestId]);

  useEffect(() => {
    load();
  }, [load]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.contestParticipantId));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) rows.forEach((r) => next.delete(r.contestParticipantId));
      else rows.forEach((r) => next.add(r.contestParticipantId));
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleExport(format: "csv" | "xlsx" | "pdf", scope: "selected" | "all") {
    if (scope === "selected" && selected.size === 0) {
      toast.error("Select at least one participant");
      return;
    }
    setExporting(true);
    try {
      const res = await apiFetch(`/api/admin/contests/${contestId}/results/export`, {
        method: "POST",
        body: JSON.stringify({
          format,
          contestParticipantIds: scope === "selected" ? Array.from(selected) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      downloadBlob(blob, res.headers.get("content-disposition"));
      toast.success(`Exported results (${format.toUpperCase()})`);
    } catch {
      toast.error("Network error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Leaderboard ({rows.length})</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={selected.size === 0}
            onClick={() => setShortlistOpen(true)}
          >
            <Users className="size-4" /> Shortlist selected ({selected.size})
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={exporting}>
                {exporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={selected.size === 0}
                onClick={() => handleExport("csv", "selected")}
              >
                Selected → CSV ({selected.size})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={selected.size === 0}
                onClick={() => handleExport("xlsx", "selected")}
              >
                Selected → XLSX ({selected.size})
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={selected.size === 0}
                onClick={() => handleExport("pdf", "selected")}
              >
                Selected → PDF ({selected.size})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExport("csv", "all")}>
                All → CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("xlsx", "all")}>
                All → XLSX
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("pdf", "all")}>
                All → PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-sm text-muted-foreground">
          Only participants who have reached a final state (submitted, auto-submitted, or locked
          out) are ranked. Click a row to see their full answers, code, and proctoring log.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-12">Rank</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Exec. time</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <Loader2 className="mx-auto size-5 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    No finished attempts yet.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.contestParticipantId}
                    data-state={selected.has(r.contestParticipantId) ? "selected" : undefined}
                    className="cursor-pointer"
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('[data-slot="checkbox"]')) return;
                      setOpenParticipant(r.contestParticipantId);
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(r.contestParticipantId)}
                        onCheckedChange={() => toggleOne(r.contestParticipantId)}
                        aria-label={`Select ${r.user.username}`}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums">{r.rank}</TableCell>
                    <TableCell>{r.user.fullName ?? <span className="text-muted-foreground/50">—</span>}</TableCell>
                    <TableCell className="font-mono text-sm">{r.user.username}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.totalScore}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.tieBreakExecutionTimeMs ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <ParticipantDrilldownDialog
        contestId={contestId}
        contestParticipantId={openParticipant}
        onOpenChange={(open) => !open && setOpenParticipant(null)}
      />
      <ShortlistDialog
        open={shortlistOpen}
        onOpenChange={setShortlistOpen}
        contestId={contestId}
        contestParticipantIds={Array.from(selected)}
        onDone={() => {
          setShortlistOpen(false);
          setSelected(new Set());
        }}
      />
    </Card>
  );
}
