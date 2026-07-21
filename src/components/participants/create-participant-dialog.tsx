"use client";

import { useState } from "react";
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
import type { IssuedCredential } from "./types";

export function CreateParticipantDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (credential: IssuedCredential) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    username: "",
    fullName: "",
    email: "",
    phone: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/participants", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not create participant");
        return;
      }
      setForm({ username: "", fullName: "", email: "", phone: "" });
      onOpenChange(false);
      onCreated(data.credential as IssuedCredential);
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add participant</DialogTitle>
            <DialogDescription>
              Creates a candidate account and issues a login password (shown once).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cp-username">
                Username <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cp-username"
                value={form.username}
                onChange={set("username")}
                placeholder="e.g. jsmith"
                autoComplete="off"
                required
              />
              <p className="text-xs text-muted-foreground">
                3–32 chars: lowercase letters, digits, dot, underscore, hyphen.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cp-fullName">Full name</Label>
              <Input id="cp-fullName" value={form.fullName} onChange={set("fullName")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cp-email">Email</Label>
                <Input
                  id="cp-email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cp-phone">Phone</Label>
                <Input id="cp-phone" value={form.phone} onChange={set("phone")} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !form.username.trim()}>
              {submitting ? "Creating…" : "Create participant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
