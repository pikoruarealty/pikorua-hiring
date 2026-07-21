"use client";

import { useState } from "react";
import { Copy, Check, KeyRound } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { IssuedCredential } from "./types";

/**
 * One-time credential reveal shown after creating a single participant. The
 * password can't be recovered later — only re-issued via Export.
 */
export function CredentialDialog({
  credential,
  onClose,
}: {
  credential: IssuedCredential | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={credential !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Credential issued
          </DialogTitle>
          <DialogDescription>
            Copy these now — the password is shown once and cannot be retrieved
            later. You can re-issue it later from Export.
          </DialogDescription>
        </DialogHeader>
        {credential && (
          <div className="grid gap-3">
            <Field label="Username" value={credential.username} />
            <Field label="Password" value={credential.password} mono />
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (credential) {
                navigator.clipboard.writeText(
                  `${credential.username}\t${credential.password}`,
                );
                toast.success("Copied username and password");
              }
            }}
          >
            Copy both
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code
          className={`flex-1 rounded-md border bg-muted px-3 py-2 text-sm ${
            mono ? "font-mono" : ""
          }`}
        >
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
