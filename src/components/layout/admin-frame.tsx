import Link from "next/link";
import type { ReactNode } from "react";
import { StandaloneFrame } from "@/components/layout/standalone";
import { buttonClasses } from "@/components/ui/button-classes";

const ITEMS = [
  { id: "overview", href: "/admin", label: "Vue d'ensemble" },
  { id: "requests", href: "/admin/club-requests", label: "Demandes de club" },
] as const;

export type AdminSection = (typeof ITEMS)[number]["id"];

/** Cadre de la console d'administration de la plateforme (réservée à l'administrateur : le garde est dans chaque page). */
export function AdminFrame({ current, children }: { current: AdminSection; children: ReactNode }) {
  return (
    <StandaloneFrame
      width="wide"
      aside={
        <Link href="/academies" className={buttonClasses({ variant: "ghost", className: "px-2 sm:px-3" })}>
          Mes clubs
        </Link>
      }
    >
      <nav aria-label="Administration" className="-mt-2 mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {ITEMS.map((i) => (
          <Link
            key={i.id}
            href={i.href}
            aria-current={i.id === current ? "page" : undefined}
            className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold no-underline ${
              i.id === current ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {i.label}
          </Link>
        ))}
      </nav>
      {children}
    </StandaloneFrame>
  );
}
