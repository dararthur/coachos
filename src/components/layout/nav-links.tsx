"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavIcon = "home" | "users" | "calendar" | "check" | "chart" | "settings" | "qr";

export interface NavItem {
  href: string;
  label: string;
  /** Libellé court pour la barre d'onglets mobile. */
  short: string;
  icon: NavIcon;
}

const PATHS: Record<NavIcon, string> = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  users: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-7 8-7s8 3 8 7",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  check: "M5 12l5 5L20 7",
  chart: "M5 20V10M12 20V4M19 20v-8",
  settings: "M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M8 15v4",
  qr: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2z",
};

function Icon({ name }: { name: NavIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

/** Navigation latérale (≥ md). */
export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="hidden px-3 pb-2 md:block">
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-lg px-3 py-2.5 text-sm font-medium no-underline transition-colors ${active ? "bg-white text-brand-800" : "text-white hover:bg-brand-700"}`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Barre d'onglets fixe en bas (< md) : cibles tactiles ≥ 44 px, marge de sécurité iOS/Android. */
export function MobileTabBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
      <ul className="mx-auto flex max-w-xl">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium no-underline ${active ? "text-brand-700" : "text-slate-600"}`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? "bg-brand-100" : ""}`}>
                  <Icon name={item.icon} />
                </span>
                <span className="max-w-full truncate">{item.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
