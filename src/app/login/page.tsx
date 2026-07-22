import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { UserRole } from "@/generated/prisma/enums";
import { LoginForm } from "./login-form";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function LoginPage() {
  // Already authenticated? Skip the form.
  const user = await getSessionUser();
  if (user) {
    redirect(user.role === UserRole.ADMIN ? "/admin" : "/participant");
  }

  return (
    <div className="relative flex flex-1 items-center justify-center p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <LoginForm />
    </div>
  );
}
