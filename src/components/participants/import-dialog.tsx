"use client";

import { useState } from "react";
import { UploadCloud } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { ImportResult } from "./types";

const SAMPLE = `username,fullName,email,phone
jsmith,Jane Smith,jane@example.com,+1 555 0100
rkumar,Ravi Kumar,ravi@example.com,
,Nadia Ali,nadia@example.com,`;

export function ImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [csv, setCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setCsv("");
    setResult(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
  }

  async function handleImport() {
    if (!csv.trim()) {
      toast.error("Paste or upload some CSV first");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/admin/participants/bulk-import", {
        method: "POST",
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Import failed");
        return;
      }
      setResult(data as ImportResult);
      onImported();
      toast.success(`Imported ${data.summary.created} participant(s)`);
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk import participants</DialogTitle>
          <DialogDescription>
            Upload or paste CSV with a header row. Recognized columns:{" "}
            <span className="font-mono">username, fullName, email, phone</span>.
            Missing usernames are auto-generated. Duplicates are skipped and
            reported.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-3 py-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed py-4 text-sm text-muted-foreground hover:bg-muted/50">
              <UploadCloud className="size-4" />
              Choose a .csv file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFile}
              />
            </label>
            <Textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={SAMPLE}
              rows={9}
              className="font-mono text-xs"
            />
          </div>
        ) : (
          <ImportReport result={result} />
        )}

        <DialogFooter>
          {!result ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={submitting}>
                {submitting ? "Importing…" : "Import"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={reset}>
                Import more
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportReport({ result }: { result: ImportResult }) {
  return (
    <div className="grid gap-3 py-2">
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="secondary">{result.summary.totalRows} rows</Badge>
        <Badge>{result.summary.created} created</Badge>
        {result.summary.skipped > 0 && (
          <Badge variant="destructive">{result.summary.skipped} skipped</Badge>
        )}
      </div>
      <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        Passwords are not set yet. Close this, then use{" "}
        <span className="font-medium text-foreground">Export → PDF/CSV</span> to
        issue and hand out credentials.
      </div>
      {result.skipped.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Row</th>
                <th className="px-2 py-1.5 text-left font-medium">Username</th>
                <th className="px-2 py-1.5 text-left font-medium">Reason skipped</th>
              </tr>
            </thead>
            <tbody>
              {result.skipped.map((s, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1.5 tabular-nums">{s.row}</td>
                  <td className="px-2 py-1.5 font-mono">{s.username ?? "—"}</td>
                  <td className="px-2 py-1.5">{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
