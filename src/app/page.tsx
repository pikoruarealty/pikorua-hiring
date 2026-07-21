import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { UserRole } from "@/generated/prisma/enums";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(user.role === UserRole.ADMIN ? "/admin" : "/participant");
}
