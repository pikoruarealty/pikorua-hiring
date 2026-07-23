import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { prisma } from "@/lib/db";
import { UserRole } from "@/generated/prisma/enums";

export default async function AdminDashboard() {
  const [participantCount, questionCount, contestCount] = await Promise.all([
    prisma.user.count({ where: { role: UserRole.PARTICIPANT } }),
    prisma.question.count({ where: { isArchived: false } }),
    prisma.contest.count(),
  ]);

  const stats = [
    {
      label: "Participants",
      value: participantCount,
      hint: "Registered candidate accounts",
      href: "/admin/participants",
    },
    {
      label: "Question bank",
      value: questionCount,
      hint: "Reusable questions",
      href: "/admin/questions",
    },
    { label: "Contests", value: contestCount, hint: "All statuses", href: "/admin/contests" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Overview of your assessment platform. Feature modules arrive in later
          phases (participants, question bank, contests, results).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="block">
            <Card className="transition-colors hover:bg-muted/40">
              <CardHeader className="pb-2">
                <CardDescription>{s.label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{s.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">{s.hint}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Link href="/admin/participants" className="block">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Participant management
              <ArrowRight className="size-4 text-muted-foreground" />
            </CardTitle>
            <CardDescription>
              Create candidate accounts, bulk-import from CSV, and export login
              credentials as CSV or PDF.
            </CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}
