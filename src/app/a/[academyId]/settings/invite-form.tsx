"use client";

import { useState } from "react";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { CopyShare } from "@/components/ui/copy-share";
import { inviteAction } from "@/server/actions/team";
import { ROLE_LABELS, type Role } from "@/domain/roles";
import type { ActionResult } from "@/domain/errors";

type Created = { link: string; email: string };

/**
 * Invitation par lien (aucun e-mail n'est envoyé par Matnexa) : le lien s'affiche une fois, avec « Copier » et, sur téléphone,
 * « Partager » (WhatsApp, SMS…). La fiche à relier n'est proposée que pour le rôle Membre, le seul où elle sert.
 */
export function InviteForm({ academyId, roles, members }: { academyId: string; roles: Role[]; members: { id: string; name: string }[] }) {
  const [created, setCreated] = useState<Created | null>(null);
  const [role, setRole] = useState<Role>(roles.includes("coach") ? "coach" : (roles[0] ?? "member"));
  return (
    <div className="space-y-3">
      <ActionForm
        action={inviteAction.bind(null, academyId)}
        className="grid gap-4 sm:grid-cols-4"
        resetOnSuccess
        hideMessage={Boolean(created)}
        onResult={(r: ActionResult<Created> | null) => setCreated(r && r.ok ? r.data : null)}
      >
        <TextField label="E-mail" name="email" type="email" required className="sm:col-span-2" autoComplete="off" hint="L'adresse avec laquelle la personne créera son compte." />
        <SelectField label="Rôle" name="role" required defaultValue={role} onChange={(e) => setRole(e.currentTarget.value as Role)}>
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </SelectField>
        {role === "member" && members.length > 0 && (
          <SelectField label="Fiche membre liée" name="personId" hint="Facultatif : relie le compte à une fiche existante.">
            <option value="">Aucune</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </SelectField>
        )}
        <div className="sm:col-span-4">
          <SubmitButton pendingLabel="Création…">Créer le lien d&apos;invitation</SubmitButton>
        </div>
      </ActionForm>
      {created && (
        <div role="status" className="rounded-sm border border-success/30 bg-success-soft p-4 text-sm text-success-ink">
          <p className="font-semibold">Invitation créée pour {created.email}</p>
          <p className="mt-1">
            Envoyez ce lien à la personne (message, WhatsApp, e-mail) : Matnexa ne l&apos;envoie pas. Il n&apos;est affiché qu&apos;une seule fois, expire dans 7 jours et ne fonctionne qu&apos;avec cette adresse e-mail.
          </p>
          <label htmlFor="invite-link" className="mt-2 block font-medium">Lien d&apos;invitation</label>
          <input id="invite-link" readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} className="mt-1 block min-h-11 w-full rounded-sm border border-success/30 bg-white px-3 py-2 font-mono text-xs text-ink" />
          <CopyShare className="mt-3" text={created.link} shareTitle="Invitation Matnexa" shareText="Voici ton invitation pour rejoindre le club sur Matnexa :" />
        </div>
      )}
    </div>
  );
}
