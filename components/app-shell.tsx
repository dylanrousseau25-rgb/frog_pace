"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BottomNav } from "./bottom-nav";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login" || pathname.startsWith("/auth/") || pathname.startsWith("/legal")) return <>{children}</>;

  return (
    <div className="frog-shell">
      <header className="frog-header">
        <Link href="/today" className="frog-brand">
          <span className="frog-logo">🐸</span>
          <span>Frog Pace</span>
        </Link>
        <Link href="/profile" className="frog-avatar">FP</Link>
      </header>
      <div className="frog-content">{children}</div>
      <BottomNav />
    </div>
  );
}
