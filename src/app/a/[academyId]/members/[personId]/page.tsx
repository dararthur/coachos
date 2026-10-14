import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatCalendarDate } from "@/domain/dates";
import { formatPhone, whatsappHref } from "@/domain/phone";
import { can } from "@/domain/roles";
import { Alert, BackLink, Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatGrid } from "@/components/ui/ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Avatar } from "@/components/ui/avatar";
import { BeltLabel } from "@/components/ui/belt";
import { BELT_LABELS, BELTS, MAX_STRIPES } from "@/domain/profile";
import { ConfirmAction } from "@/components/ui/confirm";
import { eraseMemberAction, setMemberArchivedAction, updateMemberAction } from "@/server/actions/members";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { personHistory, personTotals } from "@/server/repositories/attendance";
import { getPerson } from "@/server/repositories/members";
import { Assiduity, weeksAttended } from "@/components/ui/assiduity";
import { AttendanceHistory } from "@/components/ui/attendance-history";
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
        back={<BackLink href={`/a/${academyId}/members`}>Membres</BackLink>}
        description={
          <>
            {person.archivedAt ? <Badge>Archivé</Badge> : <Badge tone="success">Actif</Badge>}
            {person.anonymizedAt && <Badge tone="warning">Anonymisé</Badge>}
            {person.joinedOn && <span>Inscrit(e) le {formatCalendarDate(person.joinedOn)}</span>}
          </>
        }
        actions={
          !person.anonymizedAt && (person.email || person.phone) ? (
            <>
              {person.phone && (
                <LinkButton href={whatsappHref(person.phone, `Bonjour ${person.firstName}, `)} newTab variant="secondary" icon="chat">
                  WhatsApp
                </LinkButton>
              )}
              {person.email && (
                <LinkButton href={`mailto:${person.email}`} variant="secondary" icon="mail">
                  Écrire
                </LinkButton>
              )}
            </>
          ) : undefined
        }
      />
      {sp.created && <Alert tone="success">Membre créé.</Alert>}

      <div className="mb-6 grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <StatGrid cols={3}>
          <Stat label="Présences" value={totals.attended} />
          <Stat label="30 derniers jours" value={totals.last30} />
          <Stat label="Absences notées" value={totals.absent} />
        </StatGrid>
        <Assiduity weeks={weeksAttended(history, tz)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <Card title="Historique des présences" flush>
            {history.length === 0 ? (
              <EmptyState level={3} title="Aucune présence enregistrée">Les présences apparaîtront ici dès le prochain appel.</EmptyState>
            ) : (
              <AttendanceHistory caption="Historique des présences du membre" tz={tz} rows={history.map((h) => ({ key: h.sessionId, startsAt: h.startsAt, classTypeName: h.classTypeName, status: h.status }))} />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Informations">
            <div className="mb-4 flex items-center gap-3 border-b border-line pb-4">
              <Avatar academyId={academyId} personId={personId} avatarStyle={person.avatarStyle} hasPhoto={person.hasPhoto} size="md" />
              <BeltLabel belt={person.belt} stripes={person.beltStripes} />
            </div>
            {canEdit ? (
              <ActionForm action={updateMemberAction.bind(null, academyId, personId)} className="space-y-4">
                <TextField label="Prénom" name="firstName" defaultValue={person.firstName} required maxLength={80} />
                <TextField label="Nom" name="lastName" defaultValue={person.lastName} required maxLength={80} />
                <TextField label="E-mail" name="email" type="email" defaultValue={person.email} maxLength={254} />
                <TextField label="Téléphone" name="phone" type="tel" inputMode="tel" defaultValue={person.phone ? formatPhone(person.phone) : null} maxLength={30} hint="Pour le recontacter sur WhatsApp." />
                <TextField label="Date d'inscription" name="joinedOn" type="date" defaultValue={person.joinedOn} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <SelectField label="Ceinture" name="belt" defaultValue={person.belt ?? ""}>
                    <option value="">Non renseigné</option>
                    {BELTS.map((b) => (
                      <option key={b} value={b}>
                        {BELT_LABELS[b]}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField label="Barrettes" name="beltStripes" defaultValue={String(person.beltStripes)}>
                    {Array.from({ length: MAX_STRIPES + 1 }, (_, n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <SubmitButton>Enregistrer</SubmitButton>
              </ActionForm>
            ) : (
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-ink-soft">E-mail</dt>
                  <dd>{person.email ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Téléphone</dt>
                  <dd>{person.phone ? formatPhone(person.phone) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-ink-soft">Inscription</dt>
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
                  <LinkButton href={`/a/${academyId}/members/${personId}/export`} variant="secondary" download>
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
                description={
                  <p>
                    Membre concerné : <strong className="text-ink">{person.firstName} {person.lastName}</strong>
                    {person.email ? ` (${person.email})` : ""}. Cette action est définitive. Choisissez le mode d&apos;effacement.
                  </p>
                }
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
