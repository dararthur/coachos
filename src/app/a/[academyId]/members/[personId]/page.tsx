import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { formatCalendarDate } from "@/domain/dates";
import { formatPhone, whatsappHref } from "@/domain/phone";
import { can } from "@/domain/roles";
import { Alert, BackLink, Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatGrid } from "@/components/ui/ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { Avatar } from "@/components/ui/avatar";
import { BeltLabel, BeltOptions } from "@/components/ui/belt";
import { MAX_STRIPES } from "@/domain/profile";
import { ConfirmAction } from "@/components/ui/confirm";
import { PauseBadge } from "@/components/ui/pause-badge";
import { PauseForm } from "@/components/ui/pause-forms";
import { GradeCard } from "@/components/ui/grade-card";
import { assessEligibility } from "@/domain/graduation";
import { listPromotions } from "@/server/repositories/graduation";
import { DEPARTURE_REASONS } from "@/domain/lifecycle";
import { clearMemberPauseAction, eraseMemberAction, mergeDuplicateAction, deleteGradeAction, recordPromotionAction, resendGuardianConsentAction, setBeltSinceAction, setMemberArchivedAction, setMemberPauseAction, updateGradeAction, updateGuardianAction, updateMemberAction, withdrawGuardianConsentAction } from "@/server/actions/members";
import { ageOn } from "@/domain/minors";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { personHistory, personTotals } from "@/server/repositories/attendance";
import { getGuardian, getPerson, listMergeCandidates } from "@/server/repositories/members";
import { Assiduity, weeksAttended } from "@/components/ui/assiduity";
import { AttendanceHistory } from "@/components/ui/attendance-history";
import { EraseForm } from "./erase-form";

export const metadata: Metadata = { title: "Fiche membre" };

export default async function MemberPage({ params, searchParams }: { params: Promise<{ academyId: string; personId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { academyId, personId } = await params;
  const sp = await searchParams;
  const ctx = await requireAcademy(academyId, "members.read");
  const todayInZone = (zone: string) => new Intl.DateTimeFormat("fr-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!z.uuid().safeParse(personId).success) notFound();

  // Module « Grades et rapports » coupé pour le club : ni historique, ni éligibilité, ni saisie (la ceinture de la fiche reste modifiable).
  const gradesOn = can(ctx.role, "members.grade") && !ctx.disabledFeatures.includes("reports");
  const data = await inAcademy(ctx, async (tx) => {
    const person = await getPerson(tx, academyId, personId);
    if (!person) return null;
    const guardian = person.birthDate ? await getGuardian(tx, academyId, personId) : null;
    const grades = gradesOn ? await listPromotions(tx, personId) : [];
    // Fiche saisie ou importée, sans compte : l'adhérent a peut-être déjà créé son compte (donc une seconde fiche) via le lien d'inscription.
    const canMerge = can(ctx.role, "members.update") && !person.birthDate && !person.hasAccount && !person.archivedAt && !person.anonymizedAt;
    const duplicates = canMerge ? await listMergeCandidates(tx, academyId, personId) : [];
    return { person, guardian, grades, duplicates, history: await personHistory(tx, academyId, personId), totals: await personTotals(tx, academyId, personId) };
  });
  if (!data) notFound();
  const { person, guardian, grades, duplicates, history, totals } = data;
  const isMinor = Boolean(person.birthDate);
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
            {person.birthDate && <Badge tone="warning">Mineur · {ageOn(person.birthDate)} ans</Badge>}
            <PauseBadge reason={person.pauseReason} until={person.pausedUntil} />
            {person.joinedOn && <span>Inscrit(e) le {formatCalendarDate(person.joinedOn)}</span>}
          </>
        }
        actions={
          !person.anonymizedAt && isMinor ? (
            // Mineur : les messages vont au responsable légal, jamais à l'enfant (et seulement une fois son accord confirmé).
            guardian && guardian.consentConfirmedAt && !guardian.consentWithdrawnAt ? (
              <>
                {guardian.phone && (
                  <LinkButton href={whatsappHref(guardian.phone, `Bonjour ${guardian.name}, au sujet de ${person.firstName} : `)} newTab variant="secondary" icon="chat">
                    WhatsApp au responsable
                  </LinkButton>
                )}
                <LinkButton href={`mailto:${guardian.email}`} variant="secondary" icon="mail">
                  Écrire au responsable
                </LinkButton>
              </>
            ) : undefined
          ) : !person.anonymizedAt && (person.email || person.phone) ? (
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
      {sp.created && sp.consent === "sent" && <Alert tone="success">Un lien d&apos;accord a été envoyé au responsable légal.</Alert>}
      {sp.created && sp.consent === "failed" && <Alert tone="warning">Le lien d&apos;accord n&apos;a pas pu être envoyé : utilisez « Renvoyer le lien » ci-dessous.</Alert>}

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
                {!isMinor && <TextField label="E-mail" name="email" type="email" defaultValue={person.email} maxLength={254} />}
                {!isMinor && <TextField label="Téléphone" name="phone" type="tel" inputMode="tel" defaultValue={person.phone ? formatPhone(person.phone) : null} maxLength={30} hint="Pour le recontacter sur WhatsApp." />}
                <TextField label="Date d'inscription" name="joinedOn" type="date" defaultValue={person.joinedOn} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  <SelectField label="Ceinture" name="belt" defaultValue={person.belt ?? ""}>
                    <BeltOptions />
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

          {duplicates.length > 0 && (
            <Card title="Compte déjà créé ?" description="Un adhérent qui s'inscrit avec le lien du club obtient une seconde fiche. Rattachez son compte à celle-ci.">
              <ConfirmAction
                action={mergeDuplicateAction.bind(null, academyId, personId)}
                trigger="Rattacher un compte…"
                title="Rattacher un compte à cette fiche ?"
                description={
                  <p>
                    Le compte choisi est relié à la fiche de <strong className="text-ink">{person.firstName} {person.lastName}</strong> et sa fiche en double est supprimée. Ses réservations sont reportées. L&apos;adhérent
                    devra valider de nouveau son profil.
                  </p>
                }
                confirmLabel="Rattacher"
                confirmVariant="primary"
              >
                <SelectField label="Compte à rattacher" name="duplicateId" defaultValue={duplicates[0]!.id}>
                  {duplicates.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.email ? ` · ${d.email}` : ""}
                      {d.sameName ? " (même nom)" : ""}
                    </option>
                  ))}
                </SelectField>
              </ConfirmAction>
            </Card>
          )}

          {guardian && !person.anonymizedAt && (
            <Card title="Responsable légal">
              <p className="mb-3 text-sm">
                {guardian.consentWithdrawnAt ? (
                  <Badge tone="warning">Accord retiré</Badge>
                ) : guardian.consentConfirmedAt ? (
                  <Badge tone="success">Accord confirmé le {formatCalendarDate(guardian.consentConfirmedAt.toISOString().slice(0, 10))}</Badge>
                ) : (
                  <Badge tone="warning">Accord en attente</Badge>
                )}
              </p>
              <ActionForm action={updateGuardianAction.bind(null, academyId, personId)} className="space-y-4">
                <TextField label="Nom" name="guardianName" defaultValue={guardian.name} required maxLength={80} />
                <TextField label="E-mail" name="guardianEmail" type="email" defaultValue={guardian.email} required maxLength={254} />
                <TextField label="Téléphone" name="guardianPhone" type="tel" inputMode="tel" defaultValue={guardian.phone ? formatPhone(guardian.phone) : null} maxLength={30} hint="Pour le recontacter sur WhatsApp." />
                <SubmitButton>Enregistrer le responsable</SubmitButton>
              </ActionForm>
              {!guardian.consentConfirmedAt && !guardian.consentWithdrawnAt && (
                <ActionForm action={resendGuardianConsentAction.bind(null, academyId, personId)} className="mt-4">
                  <SubmitButton pendingLabel="Envoi…">Renvoyer le lien</SubmitButton>
                </ActionForm>
              )}
              {can(ctx.role, "members.update") && !guardian.consentWithdrawnAt && (
                <div className="mt-4">
                  <ConfirmAction
                    action={withdrawGuardianConsentAction.bind(null, academyId, personId)}
                    trigger="Retirer l'accord…"
                    title="Retirer l'accord du responsable ?"
                    description={<p>À la demande du responsable légal : la fiche est archivée, la photo supprimée et le classement désactivé.</p>}
                    confirmLabel="Retirer l'accord"
                  />
                </div>
              )}
            </Card>
          )}

          {gradesOn && !person.anonymizedAt && (
            <Card title="Grade et passages" description="Historique et éligibilité : visibles de l'équipe seulement.">
              <GradeCard
                history={grades}
                eligibility={assessEligibility({ belt: person.belt, birthDate: person.birthDate, history: grades, today: todayInZone(tz) })}
                belt={person.belt}
                today={todayInZone(tz)}
                recordAction={recordPromotionAction.bind(null, academyId, personId)}
                sinceAction={setBeltSinceAction.bind(null, academyId, personId)}
                rowActions={(gradeId) => ({ update: updateGradeAction.bind(null, academyId, personId, gradeId), remove: deleteGradeAction.bind(null, academyId, personId, gradeId) })}
                editable={!person.archivedAt}
              />
            </Card>
          )}

          {can(ctx.role, "members.pause") && !person.anonymizedAt && !person.archivedAt && (
            <Card title="Pause" description="Blessure, maladie, horaires, vacances… la personne n'est plus signalée comme absente jusqu'à sa reprise.">
              <PauseForm
                mode="staff"
                minor={isMinor}
                setAction={setMemberPauseAction.bind(null, academyId, personId)}
                clearAction={clearMemberPauseAction.bind(null, academyId, personId)}
                reason={person.pauseReason}
                until={person.pausedUntil}
                today={todayInZone(tz)}
              />
            </Card>
          )}

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
                >
                  {!person.archivedAt && (
                    <SelectField label="Motif du départ (facultatif)" name="departureReason" defaultValue="">
                      <option value="">Non précisé</option>
                      {DEPARTURE_REASONS.filter((r) => r.value !== "unknown").map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.emoji} {r.label}
                        </option>
                      ))}
                    </SelectField>
                  )}
                </ConfirmAction>
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
