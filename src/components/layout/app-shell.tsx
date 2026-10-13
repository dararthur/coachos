import Link from "next/link";
import type { ReactNode } from "react";
import { can, ROLE_LABELS, type Role } from "@/domain/roles";
import { signOutAction } from "@/server/actions/auth";
import { buttonClasses } from "@/components/ui/button-classes";
import { NavLinks } from "./nav-links";

export function AppShell({ academy, role, userLabel, children }: { academy: { id: string; name: string }; role: Role; userLabel: string; children: ReactNode }) {
  const base = `/a/${academy.id}`;
  const items = [
    can(role, "dashboard.read") && { href: `${base}/dashboard`, label: "Tableau de bord" },
    role === "member" && { href: `${base}/me`, label: "Mon espace" },
    can(role, "members.read") && { href: `${base}/members`, label: "Membres" },
    { href: `${base}/schedule`, label: "Planning" },
    can(role, "attendance.record") && { href: `${base}/attendance`, label: "Présences" },
    can(role, "reports.read") && { href: `${base}/reports`, label: "Rapports" },
    can(role, "academy.update") && { href: `${base}/settings`, label: "Paramètres" },
  ].filter((i): i is { href: string; label: string } => Boolean(i));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Aller au contenu
      </a>
      <aside className="border-b border-line bg-brand-800 text-white md:sticky md:top-0 md:h-dvh md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block md:px-5 md:py-5">
          <div className="min-w-0">
            <Link href="/academies" className="text-xs uppercase tracking-wider text-brand-100 hover:underline">
              Coach OS
            </Link>
            <p className="truncate text-base font-semibold" title={academy.name}>
              {academy.name}
            </p>
            <p className="text-xs text-brand-100">{ROLE_LABELS[role]}</p>
          </div>
        </div>
        <NavLinks items={items} />
        <div className="hidden px-5 pb-5 md:absolute md:bottom-0 md:block md:w-full">
          <UserBox userLabel={userLabel} />
        </div>
      </aside>
      <div className="min-w-0">
        <main id="contenu" className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8" tabIndex={-1}>
          {children}
        </main>
        <div className="border-t border-line bg-white px-4 py-4 md:hidden">
          <UserBox userLabel={userLabel} dark={false} />
        </div>
      </div>
    </div>
  );
}

function UserBox({ userLabel, dark = true }: { userLabel: string; dark?: boolean }) {
  return (
    <div className={`space-y-2 text-sm ${dark ? "text-brand-100" : "text-muted"}`}>
      <p className="truncate" title={userLabel}>
        {userLabel}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/account" className={buttonClasses({ variant: "secondary", className: "min-h-9 px-3 py-1 text-xs" })}>
          Mon compte
        </Link>
        <form action={signOutAction}>
          <button type="submit" className={buttonClasses({ variant: "secondary", className: "min-h-9 px-3 py-1 text-xs" })}>
            Déconnexion
          </button>
        </form>
      </div>
    </div>
  );
}
