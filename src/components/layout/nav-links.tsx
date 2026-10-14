"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  /** Libellé visible dans la barre d'onglets mobile. */
  short: string;
  /** Nom accessible mobile quand le libellé court ne suffit pas ; il contient toujours le libellé visible (WCAG 2.5.3). */
  shortName?: string;
  icon: IconName;
}

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Navigation latérale (≥ md) : la section active est une bande de ruban blanc posée en travers de la barre noire. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const isActive = useActive();
  return (
    <nav aria-label="Navigation principale" className="mt-2">
      <ul className="flex flex-col gap-px">
        {items.map((item) => {
          const active = isActive(item.href);
          const tone = active ? "bg-white text-ink" : "text-bar-muted hover:bg-bar-raised hover:text-white";
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 px-5 text-sm font-semibold no-underline transition-colors duration-150 ${tone}`}
              >
                <Icon name={item.icon} size={20} />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Barre d'onglets fixe en bas (< md) : la barrette noire, onglet actif marqué d'une bande blanche ; cibles ≥ 44 px, marge de sécurité. */
export function MobileTabBar({ items }: { items: NavItem[] }) {
  const isActive = useActive();
  return (
    <nav aria-label="Navigation principale" data-surface="bar" className="fixed inset-x-0 bottom-0 z-40 bg-bar pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
      <ul className="mx-auto flex max-w-xl">
        {items.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.shortName}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 pt-1 text-[0.6875rem] font-semibold no-underline ${active ? "text-white" : "text-bar-muted"}`}
              >
                <span aria-hidden="true" className={`absolute inset-x-2 top-0 h-[3px] ${active ? "bg-white" : "bg-transparent"}`} />
                <Icon name={item.icon} size={22} />
                <span className="max-w-full truncate">{item.short}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
