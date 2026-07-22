import { ContestsClient } from "@/components/contests/contests-client";

export const metadata = { title: "Contests · Assessment Admin" };

export default function ContestsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Contests</h1>
        <p className="text-muted-foreground">
          Assemble contests from the question bank, manage the invite roster, and publish.
        </p>
      </div>
      <ContestsClient />
    </div>
  );
}
