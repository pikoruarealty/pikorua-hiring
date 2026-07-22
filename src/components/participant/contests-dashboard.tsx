"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContestListItem, ContestPhase } from "./types";

const PHASE_LABEL: Record<ContestPhase, string> = {
  UPCOMING: "Upcoming",
  ACTIVE: "Active",
  ENDED: "Ended",
};
const PHASE_VARIANT: Record<ContestPhase, "secondary" | "default" | "outline"> = {
  UPCOMING: "outline",
  ACTIVE: "default",
  ENDED: "outline",
};

function fmtIST(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function actionFor(c: ContestListItem): { label: string; enabled: boolean } {
  if (c.participantStatus === "SUBMITTED" || c.participantStatus === "AUTO_SUBMITTED") {
    return { label: "Submitted", enabled: true };
  }
  if (c.participantStatus === "LOCKED_OUT") return { label: "Locked out", enabled: false };
  if (c.participantStatus === "IN_PROGRESS") return { label: "Resume", enabled: true };
  if (c.phase === "UPCOMING") return { label: "Not started yet", enabled: false };
  if (c.phase === "ENDED") return { label: "Ended", enabled: false };
  return { label: "Enter", enabled: true };
}

export function ContestsDashboard() {
  const [contests, setContests] = useState<ContestListItem[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/api/participant/contests");
        if (!res.ok) {
          toast.error("Failed to load contests");
          return;
        }
        const body = await res.json();
        setContests(body.contests as ContestListItem[]);
      } catch {
        toast.error("Network error");
      }
    })();
  }, []);

  if (!contests) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (contests.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">No contests yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You don&apos;t have any upcoming, active, or past contests. When an admin
            invites you to a contest, it will show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3">
      {contests.map((c) => {
        const action = actionFor(c);
        return (
          <Card key={c.id}>
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.title}</span>
                  <Badge variant={PHASE_VARIANT[c.phase]}>{PHASE_LABEL[c.phase]}</Badge>
                </div>
                {c.description && (
                  <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                    {c.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmtIST(c.startAt)} – {fmtIST(c.endAt)} IST · {c.durationMinutes} min
                </p>
              </div>
              {action.enabled ? (
                <Button asChild>
                  <Link href={`/participant/contests/${c.id}`}>{action.label}</Link>
                </Button>
              ) : (
                <Button disabled variant="outline">
                  {action.label}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
