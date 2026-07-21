"use client";

import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import type { Participant } from "./types";

export function EditParticipantDialog({
  participant,
  onOpenChange,
  onSaved,
}: {
  participant: Participant | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    isActive: true,
  });

  useEffect(() => {
    if (participant) {
      setForm({
        fullName: participant.fullName ?? "",
        email: participant.email ?? "",
        phone: participant.phone ?? "",
        isActive: participant.isActive,
      });
    }
  }, [participant]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!participant) return;
    setSubmitting(true);
    try {
      const res = await apiFetch(`/api/admin/participants/${participant.id}`, {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save changes");
        return;
      }
      toast.success("Participant updated");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={participant !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit participant</DialogTitle>
            <DialogDescription>
              {participant ? (
                <>
                  Editing <span className="font-mono">{participant.username}</span>.
                  Deactivating ends any active session immediately.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ep-fullName">Full name</Label>
              <Input
                id="ep-fullName"
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ep-email">Email</Label>
                <Input
                  id="ep-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ep-phone">Phone</Label>
                <Input
                  id="ep-phone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={form.isActive}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, isActive: v === true }))
                }
              />
              Account active (can log in)
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
