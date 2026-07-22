import { ContestTakingClient } from "@/components/participant/contest-taking-client";

export default async function ContestTakingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContestTakingClient contestId={id} />;
}
