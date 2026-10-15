import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABELS } from "@/domain/roles";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui/ui";
import { StandaloneFrame } from "@/components/layout/standalone";
import { signOutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { listAcademiesForUser } from "@/server/repositories/academies";
import { ChildrenCard } from "@/components/guardian/children-card";
import { myChildrenWithSessions } from "@/server/repositories/guardian";
import { buttonClasses } from "@/components/ui/button-classes";

export const metadata: Metadata = { title: "Mes clubs" };

export default async function AcademiesPage() {
  const user = await requireUser();
  const { academies, children } = await withUser(user, async (tx) => ({ academies: await listAcademiesForUser(tx, user.id), children: await myChildrenWithSessions(tx) }));
  return (
    <StandaloneFrame
      aside={
        <div className="flex">
          <Link href="/account" className={buttonClasses({ variant: "ghost", className: "px-3" })}>
            Mon compte
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={buttonClasses({ variant: "ghost", className: "px-3" })}>
              Déconnexion
            </button>
          </form>
        </div>
      }
    >
      <PageHeader
        title="Mes clubs"
        actions={
          <LinkButton href="/onboarding" variant="secondary" icon="plus">
            Créer un club
          </LinkButton>
        }
      />
      <div className="mb-6">
        <ChildrenCard childrenRows={children} />
      </div>
      {academies.length === 0 && children.length > 0 ? null : academies.length === 0 ? (
        <EmptyState framed title="Aucun club pour le moment" action={<LinkButton href="/onboarding">Créer mon club</LinkButton>}>
          Créez votre club, ou demandez une invitation au propriétaire de votre club.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-sm border border-line bg-surface">
          {academies.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="truncate font-bold">{a.name}</p>
                <p className="text-sm text-ink-soft">{ROLE_LABELS[a.role]}</p>
              </div>
              <LinkButton href={can(a.role, "dashboard.read") ? `/a/${a.id}/dashboard` : `/a/${a.id}/me`} variant="secondary">
                Ouvrir<span className="sr-only"> {a.name}</span>
              </LinkButton>
            </li>
          ))}
        </ul>
      )}
    </StandaloneFrame>
  );
}
