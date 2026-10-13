import type { Metadata } from "next";
import Link from "next/link";
import { can, ROLE_LABELS } from "@/domain/roles";
import { Badge, Card, EmptyState, LinkButton } from "@/components/ui/ui";
import { signOutAction } from "@/server/actions/auth";
import { requireUser } from "@/server/auth/guards";
import { withUser } from "@/server/db/client";
import { listAcademiesForUser } from "@/server/repositories/academies";
import { buttonClasses } from "@/components/ui/button-classes";

export const metadata: Metadata = { title: "Mes clubs" };

export default async function AcademiesPage() {
  const user = await requireUser();
  const academies = await withUser(user, (tx) => listAcademiesForUser(tx, user.id));
  return (
    <main id="contenu" className="mx-auto w-full max-w-2xl px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mes clubs</h1>
        <div className="flex gap-2">
          <LinkButton href="/onboarding" variant="secondary">
            Créer un club
          </LinkButton>
          <Link href="/account" className={buttonClasses({ variant: "ghost" })}>
            Mon compte
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={buttonClasses({ variant: "ghost" })}>
              Déconnexion
            </button>
          </form>
        </div>
      </div>
      {academies.length === 0 ? (
        <EmptyState title="Aucun club pour le moment" action={<LinkButton href="/onboarding">Créer mon club</LinkButton>}>
          Créez votre club, ou demandez une invitation au propriétaire de votre club.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {academies.map((a) => (
            <li key={a.id}>
              <Card as="div" className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{a.name}</p>
                  <Badge tone="brand">{ROLE_LABELS[a.role]}</Badge>
                </div>
                <LinkButton href={can(a.role, "dashboard.read") ? `/a/${a.id}/dashboard` : `/a/${a.id}/me`}>Ouvrir</LinkButton>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
