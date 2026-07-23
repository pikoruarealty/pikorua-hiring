"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Loader2, ChevronLeft, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateContestDialog } from "./create-contest-dialog";
import type { ContestListItem, ContestListResponse, ContestStatus } from "./types";

const STATUS_VARIANT: Record<ContestStatus, "secondary" | "outline" | "default"> = {
  DRAFT: "outline",
  SCHEDULED: "secondary",
  LIVE: "default",
  ENDED: "outline",
  ARCHIVED: "outline",
};

export function ContestsClient() {
  const router = useRouter();
  const [data, setData] = useState<ContestListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<ContestListItem | null>(null);

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
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (status !== "all") params.set("status", status);
      if (debouncedQuery) params.set("query", debouncedQuery);
      const res = await apiFetch(`/api/admin/contests?${params}`);
      if (!res.ok) {
        toast.error("Failed to load contests");
        return;
      }
      setData(await res.json());
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  }, [page, status, debouncedQuery]);

  useEffect(() => {
    load();
  }, [load]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      const res = await apiFetch(`/api/admin/contests/${deleting.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Delete failed");
        return;
      }
      toast.success("Contest deleted");
      load();
    } catch {
      toast.error("Network error");
    } finally {
      setDeleting(null);
    }
  }

  const contests = data?.contests ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-52">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title…"
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="SCHEDULED">Scheduled</SelectItem>
            <SelectItem value="LIVE">Live</SelectItem>
            <SelectItem value="ENDED">Ended</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New contest
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead>Start (IST)</TableHead>
              <TableHead className="text-right">Questions</TableHead>
              <TableHead className="text-right">Roster</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : contests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                  No contests yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              contests.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/admin/contests/${c.id}`)}
                >
                  <TableCell className="font-medium">
                    <Link href={`/admin/contests/${c.id}`} className="hover:underline">
                      {c.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status]}>{c.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.visibility}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(c.startAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.questionCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.participantCount}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label="Row actions">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={c.status !== "DRAFT"}
                          onClick={() => setDeleting(c)}
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

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of{" "}
            {data.total}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
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

      <CreateContestDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => router.push(`/admin/contests/${id}`)}
      />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contest?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <span className="font-medium">{deleting?.title}</span>. Only
              draft contests can be deleted — unpublish a contest first if you need to remove it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-white hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
