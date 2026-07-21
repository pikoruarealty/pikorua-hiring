"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Upload,
  Download,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CreateParticipantDialog } from "./create-participant-dialog";
import { EditParticipantDialog } from "./edit-participant-dialog";
import { ImportDialog } from "./import-dialog";
import { CredentialDialog } from "./credential-dialog";
import type { IssuedCredential, ListResponse, Participant } from "./types";

type ActiveFilter = "all" | "active" | "inactive";
const FILTERS: { key: ActiveFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
];

export function ParticipantsClient() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [active, setActive] = useState<ActiveFilter>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Participant | null>(null);
  const [deleting, setDeleting] = useState<Participant | null>(null);
  const [credential, setCredential] = useState<IssuedCredential | null>(null);

  // Debounce search input.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        active,
      });
      if (debouncedQuery) params.set("query", debouncedQuery);
      const res = await apiFetch(`/api/admin/participants?${params}`);
      if (!res.ok) {
        toast.error("Failed to load participants");
        return;
      }
      setData(await res.json());
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }, [page, active, debouncedQuery]);

  useEffect(() => {
    load();
  }, [load]);

  const participants = data?.participants ?? [];
  const pageIds = participants.map((p) => p.id);
  const allPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
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

  async function handleExport(format: "csv" | "pdf", scope: "selected" | "all") {
    if (scope === "selected" && selected.size === 0) {
      toast.error("Select at least one participant");
      return;
    }
    const count = scope === "all" ? data?.total ?? 0 : selected.size;
    if (
      !confirm(
        `Export ${format.toUpperCase()} for ${count} participant(s)? This issues fresh passwords and invalidates any previously exported ones.`,
      )
    ) {
      return;
    }
    setExporting(true);
    try {
      const res = await apiFetch("/api/admin/participants/export", {
        method: "POST",
        body: JSON.stringify({
          format,
          scope,
          participantIds: scope === "selected" ? Array.from(selected) : undefined,
          active,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Export failed");
        return;
      }
      const blob = await res.blob();
      downloadBlob(blob, res.headers.get("content-disposition"));
      toast.success(`Exported credentials (${format.toUpperCase()})`);
    } catch {
      toast.error("Network error");
    } finally {
      setExporting(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const res = await apiFetch(`/api/admin/participants/${deleting.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Delete failed");
        return;
      }
      toast.success("Participant deleted");
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleting.id);
        return next;
      });
      load();
    } catch {
      toast.error("Network error");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search username, name, or email…"
            className="pl-8"
          />
        </div>
        <div className="flex rounded-md border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setActive(f.key);
                setPage(1);
              }}
              className={`rounded px-2.5 py-1 text-sm font-medium transition-colors ${
                active === f.key
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="size-4" /> Import CSV
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={exporting}>
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
              onClick={() => handleExport("pdf", "selected")}
            >
              Selected → PDF ({selected.size})
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={selected.size === 0}
              onClick={() => handleExport("csv", "selected")}
            >
              Selected → CSV ({selected.size})
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleExport("pdf", "all")}>
              All (current filter) → PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleExport("csv", "all")}>
              All (current filter) → CSV
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> Add participant
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <button
            className="text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={toggleAllOnPage}
                  aria-label="Select all on page"
                />
              </TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Contests</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : participants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  {debouncedQuery || active !== "all"
                    ? "No participants match your filters."
                    : "No participants yet. Add one or import a CSV to get started."}
                </TableCell>
              </TableRow>
            ) : (
              participants.map((p) => (
                <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={() => toggleOne(p.id)}
                      aria-label={`Select ${p.username}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm">{p.username}</TableCell>
                  <TableCell>{p.fullName ?? <Dash />}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.email ?? <Dash />}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.phone ?? <Dash />}
                  </TableCell>
                  <TableCell>
                    {p.isActive ? (
                      <Badge variant="secondary">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.contestCount}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Row actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(p)}>
                          <Pencil className="size-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleting(p)}
                        >
                          <Trash2 className="size-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {(data.page - 1) * data.pageSize + 1}–
            {Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <span className="tabular-nums">
              Page {data.page} / {data.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <CreateParticipantDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(cred) => {
          setCredential(cred);
          load();
        }}
      />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={load} />
      <EditParticipantDialog
        participant={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={load}
      />
      <CredentialDialog credential={credential} onClose={() => setCredential(null)} />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete participant?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes{" "}
              <span className="font-mono">{deleting?.username}</span>. Participants
              with contest history can&apos;t be deleted — deactivate them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground/50">—</span>;
}

/** Trigger a browser download of a blob, honoring the server filename. */
function downloadBlob(blob: Blob, disposition: string | null) {
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? "credentials";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
