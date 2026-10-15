import Link from "next/link";
import type { ReactNode } from "react";
import { SCAN_PATH } from "@/domain/checkin";
import { can, ROLE_LABELS, type Role } from "@/domain/roles";
import { signOutAction } from "@/server/actions/auth";
import { switchViewAction } from "@/server/actions/view-mode";
import { MatnexaLogo } from "@/components/brand/logo";
import { AcademyLogo } from "@/components/ui/academy-logo";
import { InstallApp } from "@/components/ui/install-app";
import { Icon } from "@/components/ui/icons";
import { MobileTabBar, NavLinks, type NavItem } from "./nav-links";

export function AppShell({ academy, role, viewAsMember = false, userLabel, children }: { academy: { id: string; name: string; logoVersion: number | null }; role: Role; viewAsMember?: boolean; userLabel: string; children: ReactNode }) {
  const base = `/a/${academy.id}`;
  // En mode membre, l'équipe voit la navigation d'un adhérent ; ses droits réels ne changent pas (ils sont vérifiés côté serveur et par la base).
  const shown: Role = viewAsMember ? "member" : role;
  const entries: (NavItem | false)[] = [
    can(shown, "dashboard.read") && { href: `${base}/dashboard`, label: "Tableau de bord", short: "Accueil", icon: "home" },
    shown === "member" && { href: `${base}/me`, label: "Mon espace", short: "Espace", icon: "home", also: [`${base}/profile`] },
    can(shown, "members.read") && { href: `${base}/members`, label: "Membres", short: "Membres", icon: "users" },
    { href: `${base}/schedule`, label: "Planning", short: "Planning", icon: "calendar" },
    { href: `${base}/news`, label: "Actualités", short: "Actus", icon: "news" },
    shown === "member" && { href: `${base}/ranking`, label: "Classement", short: "Classement", icon: "trophy" },
    shown === "member" && { href: SCAN_PATH, label: "Pointer ma présence", short: "Pointer", shortName: "Pointer ma présence", icon: "qr" },
    can(shown, "attendance.record") && { href: `${base}/attendance`, label: "Présences", short: "Appel", shortName: "Présences (appel)", icon: "roll" },
    can(shown, "reports.read") && { href: `${base}/reports`, label: "Rapports", short: "Rapports", icon: "chart" },
    can(shown, "academy.update") && { href: `${base}/settings`, label: "Paramètres", short: "Réglages", icon: "settings" },
  ];
  const items = entries.filter((i): i is NavItem => Boolean(i));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)] print:block">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-surface focus:px-4 focus:py-3 focus:font-semibold">
        Aller au contenu
      </a>
      <SideBar academy={academy} role={role} viewAsMember={viewAsMember} userLabel={userLabel} items={items} />
      <MobileTopBar academy={academy} role={role} viewAsMember={viewAsMember} />
      <div className="min-w-0">
        <main id="contenu" className="mx-auto w-full max-w-6xl px-4 pb-32 pt-5 sm:px-6 md:px-8 md:pb-12 md:pt-8 print:max-w-none print:p-0" tabIndex={-1}>
          {children}
          {/* Après le contenu : sur téléphone, le bandeau ne repousse plus la première information sous la barre d'onglets. */}
          <InstallApp banner />
        </main>
      </div>
      <MobileTabBar items={items} />
    </div>
  );
}
type Shell = { academy: { id: string; name: string; logoVersion: number | null }; role: Role; viewAsMember: boolean };

/** Bascule de l'équipe entre son espace de travail et l'espace d'un adhérent (réserver d'autres cours, pointer, classement). */
function ViewSwitch({ academyId, viewAsMember, compact = false }: { academyId: string; viewAsMember: boolean; compact?: boolean }) {
  const label = viewAsMember ? "Mode coach" : "Mode membre";
  return (
    <form action={switchViewAction.bind(null, academyId, viewAsMember ? "staff" : "member")}>
      <button
        type="submit"
        title={viewAsMember ? "Revenir à l'espace de l'équipe" : "Voir et réserver les cours comme un adhérent"}
        className={compact ? "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-semibold hover:bg-sunken" : "-mx-2 inline-flex min-h-11 w-[calc(100%+1rem)] items-center gap-2.5 rounded-sm px-2 font-semibold text-white hover:bg-bar-raised"}
      >
        <Icon name="users" size={compact ? 20 : 18} />
        <span className={compact ? "sr-only min-[30rem]:not-sr-only" : undefined}>{label}</span>
      </button>
    </form>
  );
}

/** Barre latérale (≥ md) : la barrette noire. Marque, club, navigation, puis le compte en pied. */
function SideBar({ academy, role, viewAsMember, userLabel, items }: Shell & { userLabel: string; items: NavItem[] }) {
  return (
    <aside data-surface="bar" className="hidden bg-bar text-bar-text md:sticky md:top-0 md:flex md:h-dvh md:flex-col print:hidden">
      <div className="px-5 pb-4 pt-6">
        <Link href="/" title="Accueil" className="inline-flex min-h-11 items-center no-underline">
          <MatnexaLogo tone="light" />
        </Link>
        <div className="mt-5 flex items-center gap-3 border-t border-white/15 pt-4">
          <AcademyLogo academy={academy} size={40} className="bg-white" />
          <div className="min-w-0">
            <p className="line-clamp-2 break-words text-base font-bold leading-tight" title={academy.name}>
              {academy.name}
            </p>
            {role !== "member" && <p className="text-xs font-medium text-bar-muted">{ROLE_LABELS[role]}{viewAsMember ? " · mode membre" : ""}</p>}
          </div>
        </div>
      </div>
      <NavLinks items={items} />
      <div className="mt-auto border-t border-white/15 px-5 pb-5 pt-4 text-sm">
        <p className="mb-2 truncate text-xs text-bar-muted" title={userLabel}>
          {userLabel}
        </p>
        <div className="flex flex-col">
          {role !== "member" && <ViewSwitch academyId={academy.id} viewAsMember={viewAsMember} />}
          <Link href="/account" className="-mx-2 inline-flex min-h-11 items-center gap-2.5 rounded-sm px-2 font-semibold text-white no-underline hover:bg-bar-raised">
            <Icon name="user" size={18} />
            Mon compte
          </Link>
          <form action={signOutAction}>
            <button type="submit" className="-mx-2 inline-flex min-h-11 w-[calc(100%+1rem)] items-center gap-2.5 rounded-sm px-2 font-semibold text-bar-muted hover:bg-bar-raised hover:text-white">
              <Icon name="logout" size={18} />
              Déconnexion
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
/** Bandeau mobile (< md) : symbole, club et accès au compte ; la navigation est en bas (barre d'onglets). */
function MobileTopBar({ academy, role, viewAsMember }: Shell) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface pt-[env(safe-area-inset-top)] md:hidden print:hidden">
      <div className="flex items-center gap-3 px-4 py-1.5">
        <Link href="/" title="Accueil" className="inline-flex min-h-11 shrink-0 items-center no-underline">
          <MatnexaLogo size="sm" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2.5 border-l border-line pl-3 leading-tight">
          <AcademyLogo academy={academy} size={32} />
          <div className="min-w-0">
          <p className="line-clamp-2 break-words text-sm font-bold leading-tight">{academy.name}</p>
          {role !== "member" && <p className="truncate text-xs text-ink-soft">{ROLE_LABELS[role]}{viewAsMember ? " · mode membre" : ""}</p>}
          </div>
        </div>
        {role !== "member" && <ViewSwitch academyId={academy.id} viewAsMember={viewAsMember} compact />}
        <Link href="/account" className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-sm px-2 text-sm font-semibold no-underline hover:bg-sunken">
          <Icon name="user" size={20} />
          <span className="sr-only min-[30rem]:not-sr-only">Mon compte</span>
        </Link>
      </div>
    </header>
  );
}
