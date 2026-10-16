import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABELS } from "@/domain/roles";
import { Alert, EmptyState, LinkButton, PageHeader } from "@/components/ui/ui";
import { StandaloneFrame } from "@/components/layout/standalone";
import { signOutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { listAcademiesForUser } from "@/server/repositories/academies";
import { ChildrenCard } from "@/components/guardian/children-card";
import { myChildrenWithSessions } from "@/server/repositories/guardian";
import { mySuspendedClubs } from "@/server/repositories/suspension";
import { buttonClasses } from "@/components/ui/button-classes";

export const metadata: Metadata = { title: "Mes clubs" };

export default async function AcademiesPage() {
  const user = await requireUser();
  const { academies, children, suspended } = await withUser(user, async (tx) => ({ academies: await listAcademiesForUser(tx, user.id), children: await myChildrenWithSessions(tx), suspended: await mySuspendedClubs(tx) }));
  const parentOnly = academies.length === 0 && children.length > 0;
  return (
    <StandaloneFrame
      aside={
        <div className="flex">
          <Link href="/account" className={buttonClasses({ variant: "ghost", className: "px-2 sm:px-3" })}>
            Mon compte
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={buttonClasses({ variant: "ghost", className: "px-2 sm:px-3" })}>
              Déconnexion
            </button>
          </form>
        </div>
      }
    >
      {/* Un responsable légal sans club propre arrive ici : la page est d'abord celle de ses enfants, pas un sélecteur de clubs. */}
      <PageHeader
        title={parentOnly ? "Espace parent" : "Mes clubs"}
        description={parentOnly ? "Les cours de vos enfants et leurs inscriptions." : undefined}
        actions={
          parentOnly ? undefined : (
            <LinkButton href="/onboarding" variant="secondary" icon="plus">
              Rejoindre un club
            </LinkButton>
          )
        }
      />
      {suspended.length > 0 && (
        <div className="mb-6">
          <Alert tone="warning" title={suspended.length > 1 ? "Clubs suspendus" : "Club suspendu"}>
            L&apos;accès à {suspended.map((c) => `« ${c.name} »`).join(", ")} est momentanément fermé ; vos données sont conservées. Écrivez à <a href="mailto:contact@matnexa.fr">contact@matnexa.fr</a> pour le rouvrir.
          </Alert>
        </div>
      )}
      <div className="mb-6">
        <ChildrenCard childrenRows={children} />
      </div>
      {parentOnly ? null : academies.length === 0 ? (
        <EmptyState framed title="Aucun club pour le moment" action={<LinkButton href="/onboarding">Rejoindre mon club</LinkButton>}>
          Saisissez le code donné par votre club, ou ouvrez le lien d&apos;invitation reçu par e-mail.
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
