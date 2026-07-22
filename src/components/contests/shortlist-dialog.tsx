"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ContestListItem } from "./types";

export function ShortlistDialog({
  open,
  onOpenChange,
  contestId,
  contestParticipantIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contestId: string;
  contestParticipantIds: string[];
  onDone: () => void;
}) {
  const [contests, setContests] = useState<ContestListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetContestId, setTargetContestId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetContestId("");
    setLoading(true);
    apiFetch(`/api/admin/contests?visibility=INVITE_ONLY&pageSize=100`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(body.error ?? "Could not load contests");
          return;
        }
        const list = (body.contests as ContestListItem[]).filter((c) => c.id !== contestId);
        setContests(list);
      })
      .catch(() => toast.error("Network error"))
      .finally(() => setLoading(false));
  }, [open, contestId]);

  async function submit() {
    if (!targetContestId) {
      toast.error("Choose a target contest");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/admin/contests/${contestId}/results/shortlist`, {
        method: "POST",
        body: JSON.stringify({ targetContestId, contestParticipantIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Could not shortlist participants");
        return;
      }
      toast.success(
        `Shortlisted ${body.invited} participant(s)` +
          (body.alreadyInvited ? ` (${body.alreadyInvited} already on roster)` : ""),
      );
      onDone();
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shortlist into another contest</DialogTitle>
          <DialogDescription>
            Add {contestParticipantIds.length} selected participant(s) to another invite-only
            contest&apos;s roster.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : contests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No other invite-only contests available to shortlist into.
          </p>
        ) : (
          <Select value={targetContestId} onValueChange={setTargetContestId}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a contest" />
            </SelectTrigger>
            <SelectContent>
              {contests.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title} ({c.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <DialogFooter>
          <Button onClick={submit} disabled={submitting || !targetContestId}>
            {submitting && <Loader2 className="size-4 animate-spin" />} Shortlist
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
