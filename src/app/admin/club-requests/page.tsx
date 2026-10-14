import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { InlineAction } from "@/components/ui/confirm";
import { StandaloneFrame } from "@/components/layout/standalone";
import { formatDateTime } from "@/domain/dates";
import { decideClubRequestAction } from "@/server/actions/club-requests";
import { isPlatformAdminUser } from "@/server/auth/platform-admin";
import { getSessionUser } from "@/server/auth/session";
import { withUser } from "@/server/db/client";
import { listClubRequests } from "@/server/repositories/club-requests";

export const metadata: Metadata = { title: "Demandes de club", robots: { index: false } };

const STATUS_LABELS = { pending: "En attente", approved: "Approuvée", rejected: "Refusée", claimed: "Club créé" } as const;

/** Réservé à l'administrateur de la plateforme. Toute autre personne (connectée ou non) reçoit un 404 : la page n'existe pas pour elle. */
export default async function ClubRequestsPage() {
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/admin/club-requests")}`);
  if (!(await isPlatformAdminUser(user))) notFound();
  const rows = await withUser(user, (tx) => listClubRequests(tx));
  return (
    <StandaloneFrame width="xl">
      <h1 className="text-title font-bold font-stretch-[80%]">Demandes de création de club</h1>
      <p className="mb-6 mt-1 text-sm text-ink-soft">Rien n&apos;est créé avant votre approbation. Le demandeur est prévenu par e-mail de votre décision.</p>
      {rows.length === 0 ? (
        <p className="rounded-sm border border-line bg-surface p-6 text-sm">Aucune demande pour le moment.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-sm border border-line bg-surface p-4" data-testid="club-request">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{r.name}</p>
                  <p className="text-sm">
                    {r.contactName} · <span className="break-all">{r.email}</span>
                  </p>
                  <p className="text-xs text-ink-soft">
                    {formatDateTime(r.createdAt, "Europe/Paris")} · {r.timezone} · {r.currency}
                  </p>
                  {r.note && <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{r.note}</p>}
                </div>
                <span className="rounded-xs bg-sunken px-2 py-0.5 text-xs font-semibold">{STATUS_LABELS[r.status]}</span>
              </div>
              {r.status === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <InlineAction action={decideClubRequestAction.bind(null, r.id, true)} label="Approuver" pendingLabel="Approbation…" variant="primary" />
                  <InlineAction action={decideClubRequestAction.bind(null, r.id, false)} label="Refuser" pendingLabel="Refus…" variant="secondary" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </StandaloneFrame>
  );
}
