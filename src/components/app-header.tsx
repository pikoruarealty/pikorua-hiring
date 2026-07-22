import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { ThemeToggle } from "./theme-toggle";

interface AppHeaderProps {
  title: string;
  username: string;
  roleLabel: string;
}

export function AppHeader({ title, username, roleLabel }: AppHeaderProps) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="font-semibold tracking-tight">
          {title}
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {username}
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase text-muted-foreground">
              {roleLabel}
            </span>
          </span>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
