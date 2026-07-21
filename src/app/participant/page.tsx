import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ParticipantDashboard() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your contests</h1>
        <p className="text-muted-foreground">
          Contests you are invited to will appear here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">No contests yet</CardTitle>
          <CardDescription>
            You don&apos;t have any upcoming, active, or past contests. When an
            admin invites you to a contest, it will show up on this dashboard
            (Phase 3).
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
