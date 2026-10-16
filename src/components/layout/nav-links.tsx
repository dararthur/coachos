"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

export interface NavItem {
  href: string;
  label: string;
  /** Libellé visible dans la barre d'onglets mobile. */
  short: string;
  /** Nom accessible mobile quand le libellé court ne suffit pas ; il contient toujours le libellé visible (WCAG 2.5.3). */
  shortName?: string;
  icon: IconName;
  /** Autres chemins qui rendent cette entrée active (ex. « Mon profil », ouvert depuis « Mon espace »). */
  also?: string[];
  /** Mobile : rangé sous « Plus » quand la barre aurait plus de cinq entrées (pour garder de grandes cibles tactiles). */
  more?: boolean;
}

function useActive() {
  const pathname = usePathname();
  const match = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (item: Pick<NavItem, "href" | "also">) => match(item.href) || (item.also ?? []).some(match);
}

/** Navigation latérale (≥ md) : la section active est une bande de ruban blanc posée en travers de la barre noire. */
export function NavLinks({ items }: { items: NavItem[] }) {
  const isActive = useActive();
  return (
    <nav aria-label="Navigation principale" className="mt-2">
      <ul className="flex flex-col gap-px">
        {items.map((item) => {
          const active = isActive(item);
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

const TAB_BASE = "relative flex min-h-14 w-full flex-col items-center justify-center gap-1 px-0.5 pt-1 text-[11px] font-semibold no-underline min-[22rem]:text-xs";

/**
 * Barre d'onglets fixe en bas (< md) : la barrette noire, onglet actif marqué d'une bande blanche ; cibles ≥ 44 px, marge de sécurité.
 * Cinq entrées au plus : au-delà, les moins fréquentes (`more`) passent sous « Plus », pour des cibles larges (≥ 75 px à 375 px).
 */
export function MobileTabBar({ items }: { items: NavItem[] }) {
  const isActive = useActive();
  const pathname = usePathname();
  // Ouvert pour une page donnée : changer de page le referme sans effet de bord.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);
  const panelId = useId();
  const collapse = items.length > 5 && items.some((i) => i.more);
  const main = collapse ? items.filter((i) => !i.more) : items;
  const more = collapse ? items.filter((i) => i.more) : [];
  const moreActive = more.some(isActive);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && <button type="button" aria-label="Fermer le menu" tabIndex={-1} onClick={() => setOpen(false)} className="fixed inset-0 z-30 cursor-default bg-ink/40 md:hidden" />}
      <nav aria-label="Navigation principale" data-surface="bar" className="fixed inset-x-0 bottom-0 z-40 bg-bar pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        {open && (
          <ul id={panelId} className="mx-auto max-w-xl border-b border-white/15">
            {more.map((item) => {
              const active = isActive(item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-14 items-center gap-4 px-6 text-base font-semibold no-underline ${active ? "bg-white text-ink" : "text-white hover:bg-bar-raised"}`}
                  >
                    <Icon name={item.icon} size={22} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <ul className="mx-auto flex max-w-xl">
          {main.map((item) => {
            const active = isActive(item);
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link href={item.href} aria-current={active ? "page" : undefined} aria-label={item.shortName} className={`${TAB_BASE} ${active ? "text-white" : "text-bar-muted"}`}>
                  <span aria-hidden="true" className={`absolute inset-x-2 top-0 h-[3px] ${active ? "bg-white" : "bg-transparent"}`} />
                  <Icon name={item.icon} size={24} />
                  <span className="max-w-full truncate">{item.short}</span>
                </Link>
              </li>
            );
          })}
          {more.length > 0 && (
            <li className="min-w-0 flex-1">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen(!open)}
                className={`${TAB_BASE} ${open || moreActive ? "text-white" : "text-bar-muted"}`}
              >
                <span aria-hidden="true" className={`absolute inset-x-2 top-0 h-[3px] ${moreActive ? "bg-white" : "bg-transparent"}`} />
                <Icon name="menu" size={24} />
                <span className="max-w-full truncate">Plus</span>
              </button>
            </li>
          )}
        </ul>
      </nav>
    </>
  );
}
