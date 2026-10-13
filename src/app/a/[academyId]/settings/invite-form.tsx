"use client";

import { useState } from "react";
import { ActionForm, SelectField, SubmitButton, TextField } from "@/components/ui/form";
import { inviteAction } from "@/server/actions/team";
import { ROLE_LABELS, type Role } from "@/domain/roles";
import type { ActionResult } from "@/domain/errors";

type Created = { link: string; email: string };

export function InviteForm({ academyId, roles, members }: { academyId: string; roles: Role[]; members: { id: string; name: string }[] }) {
  const [created, setCreated] = useState<Created | null>(null);
  return (
    <div className="space-y-3">
      <ActionForm
        action={inviteAction.bind(null, academyId)}
        className="grid gap-4 sm:grid-cols-4"
        resetOnSuccess
        hideMessage={Boolean(created)}
        onResult={(r: ActionResult<Created> | null) => setCreated(r && r.ok ? r.data : null)}
      >
        <TextField label="E-mail" name="email" type="email" required className="sm:col-span-2" autoComplete="off" />
        <SelectField label="Rôle" name="role" required defaultValue="coach">
          {roles.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </SelectField>
        <SelectField label="Fiche membre liée" name="personId" hint="Pour un rôle Membre : relie le compte à sa fiche.">
          <option value="">Aucune</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </SelectField>
        <div className="sm:col-span-4">
          <SubmitButton pendingLabel="Création…">Créer le lien d&apos;invitation</SubmitButton>
        </div>
      </ActionForm>
      {created && (
        <div role="status" className="rounded-sm border border-success/30 bg-success-soft p-4 text-sm text-success-ink">
          <p className="font-semibold">Invitation créée pour {created.email}</p>
          <p className="mt-1">Transmettez ce lien à la personne. Il n&apos;est affiché qu&apos;une seule fois, expire dans 7 jours et ne fonctionne qu&apos;avec cette adresse e-mail.</p>
          <label htmlFor="invite-link" className="mt-2 block font-medium">Lien d&apos;invitation</label>
          <input id="invite-link" readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} className="mt-1 block w-full rounded-sm border border-success/30 bg-white px-3 py-2 font-mono text-xs" />
        </div>
      )}
    </div>
  );
}
