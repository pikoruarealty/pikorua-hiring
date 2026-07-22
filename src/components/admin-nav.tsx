"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/admin", label: "Dashboard", exact: true },
  { href: "/admin/participants", label: "Participants" },
  { href: "/admin/questions", label: "Question bank" },
  { href: "/admin/contests", label: "Contests" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b bg-card">
      <div className="mx-auto flex h-11 max-w-6xl items-center gap-1 px-4 text-sm">
        {LINKS.map((link) => {
          const active = link.exact
            ? pathname === link.href
            : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
