import { ContestsDashboard } from "@/components/participant/contests-dashboard";

export default function ParticipantDashboard() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your contests</h1>
        <p className="text-muted-foreground">
          Contests you are invited to (or open contests) appear here.
        </p>
      </div>
      <ContestsDashboard />
    </div>
  );
}
