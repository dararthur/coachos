import type { Metadata } from "next";
import { CURRENCIES } from "@/domain/validation";
import { CURRENCY_LABELS, TIMEZONE_OPTIONS } from "@/domain/options";
import { formatDateTime } from "@/domain/dates";
import { assignableRoles, can, canManageMember, ROLE_LABELS } from "@/domain/roles";
import { Badge, Card, DataTable, PageHeader } from "@/components/ui/ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { ConfirmAction, InlineAction } from "@/components/ui/confirm";
import {
  createClassTypeAction, createDisciplineAction, deleteAcademyAction, deleteClassTypeAction, deleteDisciplineAction, toggleClassTypeArchivedAction, toggleDisciplineArchivedAction, updateAcademyAction,
} from "@/server/actions/academy";
import { changeRoleAction, removeMemberAction, revokeInvitationAction } from "@/server/actions/team";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listClassTypes, listDisciplines } from "@/server/repositories/academies";
import { listAudit, listInvitations, listTeam } from "@/server/repositories/team";
import { getJoinCode } from "@/server/repositories/join";
import { formatJoinCode } from "@/domain/join-code";
import { env } from "@/server/env";
import { regenerateJoinCodeAction } from "@/server/actions/join";
import { listUnlinkedPeople } from "@/server/repositories/members";
import { InviteForm } from "./invite-form";
import { getCheckinSettings } from "@/server/repositories/checkin";
import { regenerateCheckinKeyAction, setCheckinSettingsAction } from "@/server/actions/checkin";
import { LinkButton } from "@/components/ui/ui";
import { CopyShare } from "@/components/ui/copy-share";
import { Icon } from "@/components/ui/icons";
import { AcademyLogo } from "@/components/ui/academy-logo";
import { ImageField } from "@/components/ui/image-field";
import { removeAcademyLogoAction, setAcademyLogoAction } from "@/server/actions/photos";

export const metadata: Metadata = { title: "Paramètres" };

/** Suppression définitive d'un type de cours (confirmation obligatoire ; refusée par la base si une séance l'utilise). */
function DeleteClassType({ academyId, id, name }: { academyId: string; id: string; name: string }) {
  return (
    <ConfirmAction
      action={deleteClassTypeAction.bind(null, academyId)}
      trigger={<>Supprimer<span className="sr-only"> le type de cours {name}</span></>}
      title={`Supprimer le type de cours « ${name} » ?`}
      description="Le type de cours est effacé définitivement. Impossible si une séance (passée ou à venir) l'utilise : archivez-le plutôt, ou supprimez d'abord ces séances."
      confirmLabel="Supprimer définitivement"
    >
      <input type="hidden" name="id" value={id} />
    </ConfirmAction>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  "catalog.class_type_deleted": "Type de cours supprimé",
  "catalog.discipline_deleted": "Discipline supprimée",
  "academy.created": "Club créé",
  "academy.settings_updated": "Paramètres du club modifiés",
  "academy.logo_set": "Logo du club modifié",
  "academy.checkin_settings_updated": "Réglages du pointage modifiés",
  "academy.checkin_key_regenerated": "QR fixe du club régénéré",
  "academy.logo_removed": "Logo du club retiré",
  "member.archived": "Membre archivé",
  "member.restored": "Membre restauré",
  "member.anonymized": "Membre anonymisé",
  "member.anonymized_by_retention": "Membre anonymisé (rétention)",
  "member.deleted": "Membre supprimé",
  "member.data_exported": "Données d'un membre exportées",
  "members.imported": "Import de membres",
  "members.exported": "Export des membres",
  "attendance.exported": "Export des présences",
  "team.invited": "Invitation créée",
  "team.joined": "Invitation acceptée",
  "team.joined_by_code": "Membre inscrit avec le code du club",
  "team.role_changed": "Rôle modifié",
  "team.removed": "Accès au club retiré",
  "academy.join_code_regenerated": "Code d'inscription régénéré",
  "member.profile_updated": "Profil complété par le membre",
  "member.ranking_visibility": "Visibilité au classement modifiée",
  "member.photo_set": "Photo de profil ajoutée",
  "member.photo_removed": "Photo de profil retirée",
  "member.minor_created": "Enfant inscrit",
  "member.minor_account_invited": "Compte propre proposé à un mineur",
  "member.guardian_updated": "Responsable légal modifié",
  "member.guardian_consent_requested": "Accord du responsable demandé",
  "member.guardian_consent_confirmed": "Accord du responsable confirmé",
  "member.guardian_consent_withdrawn": "Accord du responsable retiré",
  "booking.promoted": "Place accordée depuis la liste d'attente",
  "checkin.opened": "Pointage QR ouvert",
  "checkin.closed": "Pointage QR fermé",
  "roll.validated": "Feuille d'appel validée",
  "roll.reopened": "Feuille d'appel rouverte",
  "news.published": "Actualité publiée",
  "news.deleted": "Actualité supprimée",
  "account.data_exported": "Données d'un compte exportées",
  "account.deleted": "Compte supprimé",
};

export default async function SettingsPage({ params }: { params: Promise<{ academyId: string }> }) {
  const { academyId } = await params;
  const ctx = await requireAcademy(academyId, "academy.update");
  const tz = ctx.academy.timezone;
  const data = await inAcademy(ctx, async (tx) => ({
    disciplines: await listDisciplines(tx, academyId),
    classTypes: await listClassTypes(tx, academyId, { includeArchived: true }),
    team: await listTeam(tx, academyId),
    invitations: await listInvitations(tx, academyId),
    joinCode: await getJoinCode(tx, academyId),
    checkin: await getCheckinSettings(tx, academyId),
    audit: await listAudit(tx, academyId, 30),
    members: await listUnlinkedPeople(tx, academyId),
  }));
  const assignable = assignableRoles(ctx.role);
  const timezones = TIMEZONE_OPTIONS.some((t) => t.value === tz) ? TIMEZONE_OPTIONS : [{ value: tz, label: tz }, ...TIMEZONE_OPTIONS];

  // Équipe d'abord (propriétaires, administrateurs, coachs) ; les adhérents qui ont un compte, souvent des dizaines, sont repliés.
  const staffRows = data.team.filter((m) => m.role !== "member");
  const memberRows = data.team.filter((m) => m.role === "member");
  const teamBlock = (rows: typeof data.team) => (
    <div className="-mx-4 mb-5 border-y border-line sm:-mx-5">
              <div className="hidden sm:block">
              <DataTable bare caption="Équipe et accès" headers={["Personne", "Rôle", "Depuis", ""]}>
                {rows.map((m) => {
                  const self = m.userId === ctx.user.id;
                  const manageable = !self && canManageMember(ctx.role, m.role);
                  return (
                    <tr key={m.userId}>
                      <th scope="row" className="px-4 py-2.5 font-medium">
                        {m.displayName || m.email || "—"} {self && <Badge tone="brand">Vous</Badge>}
                        {m.displayName && m.email && <span className="block text-xs font-normal text-ink-soft">{m.email}</span>}
                      </th>
                      <td className="px-4 py-2.5">
                        {manageable ? (
                          <ActionForm action={changeRoleAction.bind(null, academyId)} className="flex items-center gap-2">
                            <input type="hidden" name="userId" value={m.userId} />
                            <label className="sr-only" htmlFor={`role-${m.userId}`}>Rôle de {m.displayName || m.email}</label>
                            <select id={`role-${m.userId}`} name="role" defaultValue={m.role} className="field w-auto min-w-36">
                              {assignable.map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                            <SubmitButton variant="secondary" pendingLabel="…">Appliquer</SubmitButton>
                          </ActionForm>
                        ) : (
                          <Badge tone="brand">{ROLE_LABELS[m.role]}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft">{formatDateTime(m.joinedAt, tz)}</td>
                      <td className="px-4 py-2.5 text-right">
                        {manageable && (
                          <ConfirmAction
                            action={removeMemberAction.bind(null, academyId)}
                            trigger="Retirer"
                            title={`Retirer ${m.displayName || m.email} ?`}
                            description={<p>La personne perd l&apos;accès au club. Ses séances restent, sans coach assigné.</p>}
                            confirmLabel="Retirer"
                          >
                            <input type="hidden" name="userId" value={m.userId} />
                          </ConfirmAction>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </DataTable>
              </div>
              <ul className="divide-y divide-line sm:hidden">
                {rows.map((m) => {
                  const self = m.userId === ctx.user.id;
                  const manageable = !self && canManageMember(ctx.role, m.role);
                  return (
                    <li key={m.userId} className="space-y-2 px-4 py-3">
                      <p className="min-w-0 font-semibold">
                        {m.displayName || m.email || "—"} {self && <Badge tone="brand">Vous</Badge>}
                        {m.displayName && m.email && <span className="block truncate text-xs font-normal text-ink-soft">{m.email}</span>}
                      </p>
                      {manageable ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <ActionForm action={changeRoleAction.bind(null, academyId)} className="flex flex-1 items-center gap-2">
                            <input type="hidden" name="userId" value={m.userId} />
                            <label className="sr-only" htmlFor={`role-m-${m.userId}`}>Rôle de {m.displayName || m.email}</label>
                            <select id={`role-m-${m.userId}`} name="role" defaultValue={m.role} className="field min-w-0 flex-1">
                              {assignable.map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                              ))}
                            </select>
                            <SubmitButton variant="secondary" pendingLabel="…">Appliquer</SubmitButton>
                          </ActionForm>
                          <ConfirmAction
                            action={removeMemberAction.bind(null, academyId)}
                            trigger="Retirer"
                            title={`Retirer ${m.displayName || m.email} ?`}
                            description={<p>La personne perd l&apos;accès au club. Ses séances restent, sans coach assigné.</p>}
                            confirmLabel="Retirer"
                          >
                            <input type="hidden" name="userId" value={m.userId} />
                          </ConfirmAction>
                        </div>
                      ) : (
                        <Badge tone="brand">{ROLE_LABELS[m.role]}</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
  );
  return (
    <>
      <PageHeader title="Paramètres" description="Configuration du club, des cours, de l'équipe et conformité." />
      <nav aria-label="Sections des paramètres" className="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {[
          ["club", "Club"],
          ["inscription", "Inscription des membres"],
          ["equipe", "Équipe"],
          ["pointage", "Pointage"],
          ["cours", "Types de cours"],
          ["disciplines", "Disciplines"],
          ...(can(ctx.role, "audit.read") ? [["journal", "Journal"]] : []),
          ...(can(ctx.role, "academy.delete") ? [["suppression", "Suppression"]] : []),
        ].map(([id, label]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-11 shrink-0 items-center px-3 text-sm font-semibold text-ink-soft no-underline hover:text-ink">
            {label}
          </a>
        ))}
      </nav>
      <div className="space-y-6">
        <Card id="club" title="Club">
          <div className="mb-5 flex max-w-2xl items-center gap-4 border-b border-line pb-5">
            {ctx.academy.logoVersion !== null ? (
              <AcademyLogo academy={ctx.academy} size={64} className="bg-sunken" />
            ) : (
              <span aria-hidden="true" className="inline-flex size-16 shrink-0 items-center justify-center rounded-sm bg-sunken text-2xl font-bold text-ink-soft">
                {ctx.academy.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
            <ImageField
              upload={setAcademyLogoAction.bind(null, academyId)}
              remove={removeAcademyLogoAction.bind(null, academyId)}
              hasImage={ctx.academy.logoVersion !== null}
              fit="inside"
              addLabel="Ajouter le logo"
              changeLabel="Changer le logo"
              removeLabel="Retirer le logo"
              hint="Facultatif. Tout format d'image ; affiché à côté du nom du club, réduit automatiquement."
            />
          </div>
          <ActionForm action={updateAcademyAction.bind(null, academyId)} className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <TextField label="Nom du club" name="name" defaultValue={ctx.academy.name} required minLength={2} maxLength={100} className="sm:col-span-2" />
            <SelectField label="Fuseau horaire" name="timezone" defaultValue={tz} required>
              {timezones.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </SelectField>
            <SelectField label="Devise" name="currency" defaultValue={ctx.academy.currency} required>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{CURRENCY_LABELS[c] ?? c}</option>
              ))}
            </SelectField>
            <TextField
              label="Conservation des membres archivés (mois)"
              name="retentionMonths"
              type="number"
              min={6}
              max={120}
              defaultValue={ctx.academy.retentionMonths}
              required
              hint="Passé ce délai, la fiche d'un membre archivé est automatiquement anonymisée."
              className="sm:col-span-2"
            />
            <div className="sm:col-span-2">
              <SubmitButton>Enregistrer</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card id="inscription" title="Inscription des membres" description="Vos adhérents s'inscrivent seuls avec ce code ou ce lien : leur fiche est créée automatiquement, sans action de votre part.">
          {data.joinCode && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">Code du club</p>
                <p data-testid="join-code" className="mt-1 font-mono text-2xl font-bold tracking-widest">{formatJoinCode(data.joinCode)}</p>
                <p className="mt-1 text-xs text-ink-soft">Valable sans limite de durée pour toutes les inscriptions à venir. Les membres le saisissent sur « Rejoindre un club ».</p>
              </div>
              <div>
                <label htmlFor="join-link" className="text-sm font-medium">Lien de partage</label>
                <input id="join-link" readOnly value={`${env().SITE_URL}/join/${data.joinCode}`} className="mt-1 block min-h-11 w-full max-w-xl rounded-sm border border-line bg-surface px-3 py-2 font-mono text-xs" />
                <p className="mt-1 text-xs text-ink-soft">Le code est déjà renseigné : à envoyer par message ou à afficher au club.</p>
                <CopyShare className="mt-3" text={`${env().SITE_URL}/join/${data.joinCode}`} shareTitle={`Rejoindre ${ctx.academy.name}`} shareText={`Inscris-toi à « ${ctx.academy.name} » sur Matnexa pour réserver tes cours :`} />
              </div>
              <ConfirmAction
                action={regenerateJoinCodeAction.bind(null, academyId)}
                trigger="Générer un nouveau code"
                title="Générer un nouveau code ?"
                description="L'ancien code et l'ancien lien cesseront immédiatement de fonctionner. Les membres déjà inscrits ne sont pas affectés."
                confirmLabel="Générer un nouveau code"
              />
            </div>
          )}
        </Card>
        <Card id="equipe" title="Équipe" description="Qui a accès au club, avec quel rôle. Invitez un coach ou un administrateur avec un lien.">
          {teamBlock(staffRows)}
          {memberRows.length > 0 && (
            <details className="group -mt-2 mb-5">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <Icon name="next" size={16} className="shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
                Adhérents avec un compte ({memberRows.length})
              </summary>
              <div className="mt-2">{teamBlock(memberRows)}</div>
            </details>
          )}

          <h3 className="mb-2 text-sm font-semibold">Inviter quelqu&apos;un</h3>
          <InviteForm academyId={academyId} roles={assignable.filter((r) => r !== "owner")} members={data.members.map((p) => ({ id: p.id, name: `${p.lastName} ${p.firstName}` }))} />

          {data.invitations.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold">Invitations en attente</h3>
              <ul className="divide-y divide-line">
                {data.invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span>
                      {i.email} · {ROLE_LABELS[i.role]} · expire le {formatDateTime(i.expiresAt, tz)}
                    </span>
                    <InlineAction action={revokeInvitationAction.bind(null, academyId)} hidden={{ id: i.id }} label="Révoquer" />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card id="pointage" title="Pointage par QR code" description="Comment vos adhérents pointent leur présence avec Matnexa. Dans les deux cas, ils doivent avoir réservé le cours.">
          <ActionForm action={setCheckinSettingsAction.bind(null, academyId)} className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <SelectField
              label="Mode de pointage"
              name="mode"
              defaultValue={data.checkin.mode}
              className="sm:col-span-2"
              hint="QR tournant : le coach l'affiche sur son téléphone pour chaque cours (le plus sûr). QR fixe : une affiche imprimée dans la salle, le cours est retrouvé selon l'heure."
            >
              <option value="rotating">QR tournant, affiché par le coach</option>
              <option value="fixed">QR fixe, affiche imprimée</option>
            </SelectField>
            <TextField label="Pointage possible avant le cours (min)" name="beforeMinutes" type="number" inputMode="numeric" min={0} max={240} defaultValue={String(data.checkin.beforeMinutes)} required hint="Utilisé par le QR fixe." />
            <TextField label="Pointage possible après le début (min)" name="afterMinutes" type="number" inputMode="numeric" min={0} max={240} defaultValue={String(data.checkin.afterMinutes)} required hint="Utilisé par le QR fixe." />
            <div className="sm:col-span-2">
              <SubmitButton>Enregistrer</SubmitButton>
            </div>
          </ActionForm>
          {data.checkin.mode === "fixed" && (
            <div className="mt-6 flex max-w-2xl flex-wrap items-center gap-3 border-t border-line pt-5">
              <LinkButton href={`/a/${academyId}/settings/qr`}>Afficher l&apos;affiche à imprimer</LinkButton>
              <ConfirmAction
                action={regenerateCheckinKeyAction.bind(null, academyId)}
                trigger="Régénérer le QR"
                title="Régénérer le QR du club ?"
                description="Les affiches déjà imprimées cesseront immédiatement de fonctionner : il faudra imprimer la nouvelle. À faire si l'affiche a été diffusée hors du club."
                confirmLabel="Régénérer le QR"
              />
            </div>
          )}
        </Card>
        <Card id="cours" title="Types de cours" description="Un type de cours = un format de séance (durée et capacité par défaut).">
          <div className="-mx-4 mb-5 border-y border-line sm:-mx-5">
            <div className="hidden sm:block">
            <DataTable bare caption="Types de cours" headers={["Cours", "Discipline", "Durée", "Capacité", ""]}>
              {data.classTypes.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className={`px-4 py-2.5 font-medium ${t.archivedAt ? "text-ink-soft line-through" : ""}`}>{t.name}</th>
                  <td className="px-4 py-2.5">{t.disciplineName}</td>
                  <td className="px-4 py-2.5">{t.durationMinutes} min</td>
                  <td className="px-4 py-2.5">{t.capacity ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <InlineAction action={toggleClassTypeArchivedAction.bind(null, academyId, !t.archivedAt)} hidden={{ id: t.id }} label={t.archivedAt ? "Restaurer" : "Archiver"} />
                      <DeleteClassType academyId={academyId} id={t.id} name={t.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
            </div>
            <ul className="divide-y divide-line sm:hidden">
              {data.classTypes.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className={`font-semibold ${t.archivedAt ? "text-ink-soft line-through" : ""}`}>{t.name}</p>
                    <p className="text-sm text-ink-soft">
                      {t.disciplineName} · {t.durationMinutes} min{t.capacity ? ` · ${t.capacity} places` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <InlineAction action={toggleClassTypeArchivedAction.bind(null, academyId, !t.archivedAt)} hidden={{ id: t.id }} label={t.archivedAt ? "Restaurer" : "Archiver"} />
                    <DeleteClassType academyId={academyId} id={t.id} name={t.name} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <ActionForm action={createClassTypeAction.bind(null, academyId)} className="grid gap-4 sm:grid-cols-4" resetOnSuccess>
            <SelectField label="Discipline" name="disciplineId" required className="sm:col-span-2">
              {data.disciplines.filter((d) => !d.archivedAt).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </SelectField>
            <TextField label="Nom du cours" name="name" required minLength={2} maxLength={80} className="sm:col-span-2" />
            <TextField label="Durée (min)" name="durationMinutes" type="number" min={15} max={360} defaultValue={60} required />
            <TextField label="Capacité" name="capacity" type="number" min={1} max={500} hint="Facultatif." />
            <div className="flex items-end">
              <SubmitButton>Ajouter</SubmitButton>
            </div>
          </ActionForm>
        </Card>
        <Card id="disciplines" title="Disciplines" description="Les disciplines regroupent vos types de cours.">
          <ul className="mb-4 divide-y divide-line">
            {data.disciplines.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className={d.archivedAt ? "text-ink-soft line-through" : "font-medium"}>{d.name}</span>
                <div className="flex flex-wrap items-center gap-2">
                  <InlineAction
                    action={toggleDisciplineArchivedAction.bind(null, academyId, !d.archivedAt)}
                    hidden={{ id: d.id }}
                    label={d.archivedAt ? "Restaurer" : "Archiver"}
                  />
                  <ConfirmAction
                    action={deleteDisciplineAction.bind(null, academyId)}
                    trigger={<>Supprimer<span className="sr-only"> la discipline {d.name}</span></>}
                    title={`Supprimer la discipline « ${d.name} » ?`}
                    description="La discipline et ses types de cours sont effacés définitivement. Impossible si une séance (passée ou à venir) les utilise : archivez-la plutôt."
                    confirmLabel="Supprimer définitivement"
                  >
                    <input type="hidden" name="id" value={d.id} />
                  </ConfirmAction>
                </div>
              </li>
            ))}
          </ul>
          <ActionForm action={createDisciplineAction.bind(null, academyId)} className="flex flex-wrap items-end gap-3" resetOnSuccess>
            <TextField label="Nouvelle discipline" name="name" required minLength={2} maxLength={60} />
            <SubmitButton>Ajouter</SubmitButton>
          </ActionForm>
        </Card>





        {can(ctx.role, "audit.read") && (
          <Card id="journal" title="Journal d'audit" description="Actions administratives récentes (aucune donnée personnelle n'y est stockée). Conservé 24 mois.">
            {data.audit.length === 0 ? (
              <p className="text-sm text-ink-soft">Aucun événement.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {data.audit.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{AUDIT_LABELS[e.action] ?? "Action administrative"}</span>
                    <span className="text-ink-soft">
                      {e.actorName ?? "Système"} · {formatDateTime(e.createdAt, tz)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {can(ctx.role, "academy.delete") && (
          <Card id="suppression" className="border-danger/40" title="Zone dangereuse" description="La suppression du club efface définitivement membres, séances, présences, invitations et équipe.">
            <ConfirmAction
              action={deleteAcademyAction.bind(null, academyId)}
              trigger="Supprimer le club"
              title="Supprimer définitivement ce club ?"
              description={
                <>
                  <p>Toutes les données du club seront supprimées. Pensez à exporter vos membres et présences avant.</p>
                  <p>
                    Pour confirmer, saisissez le nom exact du club : <strong>{ctx.academy.name}</strong>
                  </p>
                </>
              }
              confirmLabel="Supprimer définitivement"
            >
              <TextField label="Nom du club" name="confirm" required autoComplete="off" />
            </ConfirmAction>
          </Card>
        )}
      </div>
    </>
  );
}
