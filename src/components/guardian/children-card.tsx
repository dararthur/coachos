import { formatCalendarDate } from "@/domain/dates";
import { ConfirmAction } from "@/components/ui/confirm";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Card } from "@/components/ui/ui";
import { MinorAccountForm } from "@/app/account/minor-account-form";
import { setChildRankingAction, withdrawChildConsentAction } from "@/server/actions/guardian";
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
