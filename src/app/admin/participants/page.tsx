import { ParticipantsClient } from "@/components/participants/participants-client";

export const metadata = { title: "Participants · Assessment Admin" };

export default function ParticipantsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Participants</h1>
        <p className="text-muted-foreground">
          Create candidate accounts, bulk-import from CSV, and export login
          credentials. Passwords are shown once — export to (re)issue them.
        </p>
      </div>
      <ParticipantsClient />
    </div>
  );
}
