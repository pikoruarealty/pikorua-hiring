import { ContestDetailClient } from "@/components/contests/contest-detail-client";

export const metadata = { title: "Contest · Assessment Admin" };

export default async function ContestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ContestDetailClient contestId={id} />;
}
