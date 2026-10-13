import type { Metadata } from "next";
import { CURRENCIES } from "@/domain/validation";
import { CURRENCY_LABELS, TIMEZONE_OPTIONS } from "@/domain/options";
import { formatDateTime } from "@/domain/dates";
import { assignableRoles, can, canManageMember, ROLE_LABELS } from "@/domain/roles";
import { Badge, Card, DataTable, PageHeader } from "@/components/ui/ui";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { ConfirmAction, InlineAction } from "@/components/ui/confirm";
import {
  createClassTypeAction, createDisciplineAction, deleteAcademyAction, toggleClassTypeArchivedAction, toggleDisciplineArchivedAction, updateAcademyAction,
} from "@/server/actions/academy";
import { changeRoleAction, removeMemberAction, revokeInvitationAction } from "@/server/actions/team";
import { inAcademy, requireAcademy } from "@/server/auth/guards";
import { listClassTypes, listDisciplines } from "@/server/repositories/academies";
import { listAudit, listInvitations, listTeam } from "@/server/repositories/team";
import { listPeople } from "@/server/repositories/members";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Paramètres" };

const AUDIT_LABELS: Record<string, string> = {
  "academy.created": "Club créé",
  "academy.settings_updated": "Paramètres du club modifiés",
  "member.archived": "Membre archivé",
  "member.restored": "Membre restauré",
  "member.anonymized": "Membre anonymisé",
  "member.anonymized_by_retention": "Membre anonymisé (rétention)",
  "member.deleted": "Membre supprimé",
  "member.data_exported": "Données d'un membre exportées",
  "members.imported": "Import de membres",
  "members.exported": "Export des membres",
  "attendance.exported": "Export des présences",
  "team.invited": "Invitation envoyée",
  "team.joined": "Invitation acceptée",
  "team.role_changed": "Rôle modifié",
  "team.removed": "Membre d'équipe retiré",
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
    audit: await listAudit(tx, academyId, 30),
    members: (await listPeople(tx, academyId, { status: "active", page: 1, q: "" })).rows,
  }));
  const assignable = assignableRoles(ctx.role);
  const timezones = TIMEZONE_OPTIONS.some((t) => t.value === tz) ? TIMEZONE_OPTIONS : [{ value: tz, label: tz }, ...TIMEZONE_OPTIONS];

  return (
    <>
      <PageHeader title="Paramètres" description="Configuration du club, des cours, de l'équipe et conformité." />
      <nav aria-label="Sections des paramètres" className="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {[
          ["club", "Club"],
          ["disciplines", "Disciplines"],
          ["cours", "Types de cours"],
          ["equipe", "Équipe"],
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

        <Card id="disciplines" title="Disciplines" description="Les disciplines regroupent vos types de cours.">
          <ul className="mb-4 divide-y divide-line">
            {data.disciplines.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className={d.archivedAt ? "text-ink-soft line-through" : "font-medium"}>{d.name}</span>
                <InlineAction
                  action={toggleDisciplineArchivedAction.bind(null, academyId, !d.archivedAt)}
                  hidden={{ id: d.id }}
                  label={d.archivedAt ? "Restaurer" : "Archiver"}
                />
              </li>
            ))}
          </ul>
          <ActionForm action={createDisciplineAction.bind(null, academyId)} className="flex flex-wrap items-end gap-3" resetOnSuccess>
            <TextField label="Nouvelle discipline" name="name" required minLength={2} maxLength={60} />
            <SubmitButton>Ajouter</SubmitButton>
          </ActionForm>
        </Card>

        <Card id="cours" title="Types de cours" description="Un type de cours = un format de séance (durée et capacité par défaut).">
          <div className="-mx-4 mb-5 border-y border-line sm:-mx-5">
            <DataTable bare caption="Types de cours" headers={["Cours", "Discipline", "Durée", "Capacité", ""]}>
              {data.classTypes.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className={`px-4 py-2.5 font-medium ${t.archivedAt ? "text-ink-soft line-through" : ""}`}>{t.name}</th>
                  <td className="px-4 py-2.5">{t.disciplineName}</td>
                  <td className="px-4 py-2.5">{t.durationMinutes} min</td>
                  <td className="px-4 py-2.5">{t.capacity ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <InlineAction action={toggleClassTypeArchivedAction.bind(null, academyId, !t.archivedAt)} hidden={{ id: t.id }} label={t.archivedAt ? "Restaurer" : "Archiver"} />
                  </td>
                </tr>
              ))}
            </DataTable>
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

        <Card id="equipe" title="Équipe" description="Propriétaires, administrateurs, coachs et membres connectés.">
          <div className="-mx-4 mb-5 border-y border-line sm:-mx-5">
            <DataTable bare caption="Équipe et accès" headers={["Personne", "Rôle", "Depuis", ""]}>
              {data.team.map((m) => {
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

        {can(ctx.role, "audit.read") && (
          <Card id="journal" title="Journal d'audit" description="Actions administratives récentes (aucune donnée personnelle n'y est stockée). Conservé 24 mois.">
            {data.audit.length === 0 ? (
              <p className="text-sm text-ink-soft">Aucun événement.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {data.audit.map((e) => (
                  <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>{AUDIT_LABELS[e.action] ?? e.action}</span>
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
