import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { UserRole } from "@/generated/prisma/enums";
import { AppHeader } from "@/components/app-header";

export default async function ParticipantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== UserRole.PARTICIPANT) redirect("/admin");

  return (
    <>
      <AppHeader
        title="Assessment Platform"
        username={user.username}
        roleLabel="Candidate"
      />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        {children}
      </main>
    </>
  );
}
