import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { UserRole } from "@/generated/prisma/enums";
import { AppHeader } from "@/components/app-header";
import { AdminNav } from "@/components/admin-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== UserRole.ADMIN) redirect("/participant");

  return (
    <>
      <AppHeader
        title="Assessment Admin"
        username={user.username}
        roleLabel="Admin"
      />
      <AdminNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </>
  );
}
