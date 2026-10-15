import { formatCalendarDate } from "@/domain/dates";
import { ConfirmAction, InlineAction } from "@/components/ui/confirm";
import { formatDateTime } from "@/domain/dates";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Badge, Card } from "@/components/ui/ui";
import { MinorAccountForm } from "@/app/account/minor-account-form";
import { bookForChildAction, cancelChildBookingAction, setChildRankingAction, withdrawChildConsentAction } from "@/server/actions/guardian";
import type { ChildRow } from "@/server/repositories/guardian";

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
                  ? `Accord confirmé. ${c.lastAttendedAt ? `Dernier cours : ${formatCalendarDate(c.lastAttendedAt.toISOString().slice(0, 10))}.` : "Aucun cours enregistré pour l'instant."}`
                  : "Accord en attente : utilisez le lien reçu par e-mail."}
            </p>
            {c.sessions && (
              <details className="group rounded-sm border border-line">
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold">
                  <span>
                    Prochains cours de {c.firstName}
                    {c.sessions.some((s) => s.childStatus === "booked") && <span className="font-normal text-ink-soft"> · {c.sessions.filter((s) => s.childStatus === "booked").length} inscrit{c.sessions.filter((s) => s.childStatus === "booked").length > 1 ? "s" : ""}</span>}
                  </span>
                  <span aria-hidden="true" className="text-ink-soft transition-transform group-open:rotate-180">⌄</span>
                </summary>
                {c.sessions.length === 0 ? (
                  <p className="border-t border-line p-3 text-sm text-ink-soft">Aucun cours prévu dans les 14 prochains jours.</p>
                ) : (
                  <ul className="divide-y divide-line border-t border-line">
                    {c.sessions.map((s) => {
                      const label = `${s.className}, ${formatDateTime(s.startsAt, s.timezone)}`;
                      const full = s.capacity !== null && s.booked >= s.capacity;
                      return (
                        <li key={s.sessionId} className="flex flex-col items-start gap-2 px-3 py-2.5 text-sm min-[30rem]:flex-row min-[30rem]:items-center min-[30rem]:justify-between">
                          <span className="min-w-0">
                            <span className="block font-semibold">{s.className}</span>
                            <span className="block text-ink-soft">{formatDateTime(s.startsAt, s.timezone)}</span>
                          </span>
                          <span className="flex flex-wrap items-center gap-2">
                            {s.childStatus === "booked" && <Badge tone="success">Inscrit</Badge>}
                            {s.childStatus === "waitlisted" && <Badge tone="warning">Liste d&apos;attente{s.childPosition ? ` · n°${s.childPosition}` : ""}</Badge>}
                            {s.childStatus === null ? (
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
                    })}
                  </ul>
                )}
              </details>
            )}
            {c.consentConfirmedAt && !c.consentWithdrawnAt && (
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm action={setChildRankingAction.bind(null, c.childId, !c.rankingOptIn)}>
                  <SubmitButton variant="secondary">{c.rankingOptIn ? "Retirer du classement" : "Afficher au classement"}</SubmitButton>
                </ActionForm>
                <ConfirmAction
                  action={withdrawChildConsentAction.bind(null, c.childId)}
                  trigger="Retirer mon accord…"
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
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 text-sm font-semibold">
                    Donner un compte à {c.firstName}
                    <span aria-hidden="true" className="text-ink-soft transition-transform group-open:rotate-180">⌄</span>
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
