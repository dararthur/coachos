import { formatCalendarDate } from "@/domain/dates";
import { ConfirmAction, InlineAction } from "@/components/ui/confirm";
import { formatDateTime } from "@/domain/dates";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/ui";
import { MinorAccountForm } from "@/app/account/minor-account-form";
import { audienceNotice } from "@/components/ui/booking";
import { bookForChildAction, cancelChildBookingAction, setChildRankingAction, withdrawChildConsentAction } from "@/server/actions/guardian";
import type { ChildRow } from "@/server/repositories/guardian";
import { Icon } from "@/components/ui/icons";

type ChildSession = NonNullable<ChildRow["sessions"]>[number];

/**
 * Les cours d'un enfant : d'abord ceux où il est inscrit (la question du parent : « à quoi est-il inscrit ? »), toujours visibles ;
 * puis, repliés, les autres cours des 14 prochains jours à réserver pour lui.
 */
function ChildSessions({ child: c, sessions }: { child: ChildRow; sessions: ChildSession[] }) {
  const mine = sessions.filter((s) => s.childStatus !== null);
  const others = sessions.filter((s) => s.childStatus === null);
  return (
    <div className="rounded-sm border border-line">
      <p className="border-b border-line bg-sunken px-3 py-2 text-sm font-semibold">Cours de {c.firstName}</p>
      {mine.length === 0 ? (
        <p className="px-3 py-2.5 text-sm text-ink-soft">{c.firstName} n&apos;est inscrit(e) à aucun cours dans les 14 prochains jours.</p>
      ) : (
        <ul className="divide-y divide-line">
          {mine.map((s) => (
            <SessionRow key={s.sessionId} child={c} s={s} />
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <details className="group border-t border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <Icon name="next" size={16} className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
            Réserver un cours pour {c.firstName}
            <span className="font-normal text-ink-soft">({others.length})</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {others.map((s) => (
              <SessionRow key={s.sessionId} child={c} s={s} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SessionRow({ child: c, s }: { child: ChildRow; s: ChildSession }) {
  const label = `${s.className}, ${formatDateTime(s.startsAt, s.timezone)}`;
  const full = s.capacity !== null && s.booked >= s.capacity;
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="min-w-0">
        <span className="block font-semibold">{s.className}</span>
        <span className="block text-ink-soft">{formatDateTime(s.startsAt, s.timezone)}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 min-[30rem]:flex-row min-[30rem]:items-center min-[30rem]:gap-2">
        {s.childStatus === "booked" && <Badge tone="success">Inscrit</Badge>}
        {s.childStatus === "waitlisted" && <Badge tone="warning">Liste d&apos;attente{s.childPosition ? ` · n°${s.childPosition}` : ""}</Badge>}
        {s.childStatus === null && s.deniedAudience ? (
          <span className="text-ink-soft">{audienceNotice(s.deniedAudience)}</span>
        ) : s.childStatus === null ? (
          <InlineAction
            action={bookForChildAction.bind(null, c.childId, s.sessionId)}
            label={<>{full ? "Liste d'attente" : "Réserver"}<span className="sr-only"> pour {c.firstName} : {label}</span></>}
            pendingLabel="Réservation…"
            variant="secondary"
          />
        ) : (
          <InlineAction
            action={cancelChildBookingAction.bind(null, c.childId, s.sessionId)}
            label={<>{s.childStatus === "waitlisted" ? "Quitter la liste" : "Annuler"}<span className="sr-only"> pour {c.firstName} : {label}</span></>}
            pendingLabel="Annulation…"
            variant="quiet"
          />
        )}
      </span>
    </li>
  );
}

/** Les enfants dont l'utilisateur est le responsable légal : statut de l'accord, classement, compte propre, retrait de l'accord. */
export function ChildrenCard({ childrenRows, showClub = true }: { childrenRows: ChildRow[]; showClub?: boolean }) {
  if (childrenRows.length === 0) return null;
  return (
    <Card title="Mes enfants" description="Les enfants dont vous êtes le responsable légal.">
      <ul className="divide-y divide-line">
        {childrenRows.map((c) => (
          <li key={c.childId} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <p className="font-semibold">
              {c.firstName} {c.lastName} {showClub && <span className="font-normal text-ink-soft">· {c.academyName}</span>}
            </p>
            <p className="text-sm text-ink-soft">
              {c.consentWithdrawnAt
                ? "Accord retiré : fiche archivée."
                : c.consentConfirmedAt
                  ? `Accord confirmé. ${c.lastAttendedAt ? `Dernière présence : ${formatCalendarDate(c.lastAttendedAt.toISOString().slice(0, 10))}.` : "Aucune présence enregistrée pour l'instant."}`
                  : "Accord en attente : utilisez le lien reçu par e-mail."}
            </p>
            {c.sessions && <ChildSessions child={c} sessions={c.sessions} />}
            {c.consentConfirmedAt && !c.consentWithdrawnAt && (
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm action={setChildRankingAction.bind(null, c.childId, !c.rankingOptIn)}>
                  <SubmitButton variant="secondary">{c.rankingOptIn ? "Retirer du classement" : "Afficher au classement"}</SubmitButton>
                </ActionForm>
                <ConfirmAction
                  action={withdrawChildConsentAction.bind(null, c.childId)}
                  trigger="Retirer mon accord…"
                  triggerVariant="quiet"
                  title="Retirer votre accord ?"
                  description={<p>La fiche de {c.firstName} sera archivée, sa photo supprimée et son classement désactivé. Le club l&apos;anonymisera ensuite, à l&apos;issue de sa durée de conservation.</p>}
                  confirmLabel="Retirer l'accord"
                />
              </div>
            )}
            {c.consentConfirmedAt && !c.consentWithdrawnAt && c.canHaveAccount && (
              c.hasAccount ? (
                <p className="text-sm text-ink-soft">{c.firstName} a un compte propre.</p>
              ) : (
                <details className="group rounded-sm border border-line">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                    <Icon name="next" size={16} className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
                    Donner un compte à {c.firstName}
                  </summary>
                  <div className="border-t border-line p-3">
                    <MinorAccountForm childId={c.childId} firstName={c.firstName} />
                  </div>
                </details>
              )
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
