"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, ChartNoAxesCombined, MessageCircle, CalendarDays, House } from "lucide-react";

const items = [
  { href: "/today", label: "Aujourd'hui", icon: House },
  { href: "/plan", label: "Plan", icon: CalendarDays },
  { href: "/activity", label: "Activité", icon: Activity },
  { href: "/progress", label: "Progrès", icon: ChartNoAxesCombined },
  { href: "/coach", label: "Coach", icon: MessageCircle }
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="frog-bottom-nav" aria-label="Navigation principale">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className="frog-nav-item" data-active={active}>
            <Icon size={20} strokeWidth={active ? 2.5 : 2} />
            <span>{label}</span>
            <span className="frog-nav-dot" />
          </Link>
        );
      })}
    </nav>
  );
}
