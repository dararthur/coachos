import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ATTENDANCE_LABELS } from "@/domain/validation";
import { formatCalendarDate, formatDateTime } from "@/domain/dates";
import { can } from "@/domain/roles";
import { Alert, Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui/ui";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { ConfirmAction } from "@/components/ui/confirm";
import { eraseMemberAction, setMemberArchivedAction, updateMemberAction } from "@/server/actions/members";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { personHistory, personTotals } from "@/server/repositories/attendance";
import { getPerson } from "@/server/repositories/members";
import { EraseForm } from "./erase-form";

export const metadata: Metadata = { title: "Fiche membre" };

export default async function MemberPage({ params, searchParams }: { params: Promise<{ academyId: string; personId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { academyId, personId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId, "members.read");
  if (!z.uuid().safeParse(personId).success) notFound();

  const data = await inAcademy(ctx, async (tx) => {
    const person = await getPerson(tx, academyId, personId);
    if (!person) return null;
    return { person, history: await personHistory(tx, academyId, personId), totals: await personTotals(tx, academyId, personId) };
  });
  if (!data) notFound();
  const { person, history, totals } = data;
  const tz = ctx.academy.timezone;
  const canEdit = can(ctx.role, "members.update") && !person.anonymizedAt;

  return (
    <>
      <PageHeader
        title={`${person.firstName} ${person.lastName}`}
        description={
          <>
            {person.archivedAt ? <Badge>Archivé</Badge> : <Badge tone="success">Actif</Badge>}
            {person.anonymizedAt && <Badge tone="warning">Anonymisé</Badge>}
          </>
        }
        actions={<Link href={`/a/${academyId}/members`}>← Membres</Link>}
      />
      {sp.created && <Alert tone="success">Membre créé.</Alert>}

      <dl className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Présences" value={totals.attended} />
        <Stat label="30 derniers jours" value={totals.last30} />
        <Stat label="Absences notées" value={totals.absent} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Historique des présences">
            {history.length === 0 ? (
              <EmptyState title="Aucune présence enregistrée">Les présences apparaîtront ici dès le prochain appel.</EmptyState>
            ) : (
              <DataTable caption="Historique des présences du membre" headers={["Séance", "Cours", "Statut"]}>
                {history.map((h) => (
                  <tr key={h.sessionId}>
                    <td className="px-4 py-2.5">{formatDateTime(h.startsAt, tz)}</td>
                    <td className="px-4 py-2.5">{h.classTypeName}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={h.status === "absent" ? "danger" : h.status === "late" ? "warning" : "success"}>{ATTENDANCE_LABELS[h.status]}</Badge>
                    </td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Informations">
            {canEdit ? (
              <ActionForm action={updateMemberAction.bind(null, academyId, personId)} className="space-y-4">
                <TextField label="Prénom" name="firstName" defaultValue={person.firstName} required maxLength={80} />
                <TextField label="Nom" name="lastName" defaultValue={person.lastName} required maxLength={80} />
                <TextField label="E-mail" name="email" type="email" defaultValue={person.email} maxLength={254} />
                <TextField label="Date d'inscription" name="joinedOn" type="date" defaultValue={person.joinedOn} />
                <SubmitButton>Enregistrer</SubmitButton>
              </ActionForm>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-muted">E-mail</dt>
                  <dd>{person.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted">Inscription</dt>
                  <dd>{person.joinedOn ? formatCalendarDate(person.joinedOn) : "—"}</dd>
                </div>
              </dl>
            )}
          </Card>

          {can(ctx.role, "members.update") && !person.anonymizedAt && (
            <Card title="Gestion">
              <div className="flex flex-wrap items-start gap-2">
                <ConfirmAction
                  action={setMemberArchivedAction.bind(null, academyId, personId, !person.archivedAt)}
                  trigger={person.archivedAt ? "Restaurer" : "Archiver"}
                  title={person.archivedAt ? "Restaurer ce membre ?" : "Archiver ce membre ?"}
                  description={
                    person.archivedAt ? (
                      <p>Le membre redevient actif et réapparaît dans les feuilles d&apos;appel.</p>
                    ) : (
                      <p>Le membre disparaît des feuilles d&apos;appel mais son historique est conservé. Sans réactivation, sa fiche sera anonymisée automatiquement après {ctx.academy.retentionMonths} mois.</p>
                    )
                  }
                  confirmLabel={person.archivedAt ? "Restaurer" : "Archiver"}
                  confirmVariant="primary"
                />
                {can(ctx.role, "members.erase") && (
                  <LinkButton href={`/a/${academyId}/members/${personId}/export`} variant="secondary">
                    Exporter ses données
                  </LinkButton>
                )}
              </div>
            </Card>
          )}

          {can(ctx.role, "members.erase") && !person.anonymizedAt && (
            <Card title="Droit à l'effacement" description="Sur demande de la personne concernée.">
              <ConfirmAction
                action={eraseMemberAction.bind(null, academyId, personId)}
                trigger="Anonymiser ou supprimer…"
                title="Effacer les données de ce membre"
                description={<p>Cette action est définitive. Choisissez le mode d&apos;effacement.</p>}
                confirmLabel="Effacer définitivement"
              >
                <EraseForm />
              </ConfirmAction>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
