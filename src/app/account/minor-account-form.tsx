"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, TextField } from "@/components/ui/form";
import { inviteMinorAccountAction } from "@/server/actions/guardian";
import type { ActionResult } from "@/domain/errors";

type Created = { link: string; email: string };

/** Compte propre facultatif pour un mineur de 15 ans et plus : le responsable crée un lien d'invitation, affiché une seule fois. */
export function MinorAccountForm({ childId, firstName }: { childId: string; firstName: string }) {
  const [created, setCreated] = useState<Created | null>(null);
  return (
    <div className="space-y-3">
      <ActionForm
        action={inviteMinorAccountAction.bind(null, childId)}
        className="space-y-3"
        resetOnSuccess
        hideMessage={Boolean(created)}
        onResult={(r: ActionResult<Created> | null) => setCreated(r && r.ok ? r.data : null)}
      >
        <TextField label={`E-mail de ${firstName}`} name="email" type="email" required autoComplete="off" hint="Si vous le souhaitez, votre enfant peut avoir son propre compte pour suivre ses cours. Vous restez maître du classement, de la photo et de votre accord : vous pouvez le retirer à tout moment." />
        <SubmitButton variant="secondary" pendingLabel="Création…">
          Créer un lien pour son compte
        </SubmitButton>
      </ActionForm>
      {created && (
        <div role="status" className="rounded-sm border border-success/30 bg-success-soft p-4 text-sm text-success-ink">
          <p className="font-semibold">Lien créé pour {created.email}</p>
          <p className="mt-1">Transmettez-le à votre enfant. Il n&apos;est affiché qu&apos;une seule fois, expire dans 7 jours et ne fonctionne qu&apos;avec cette adresse e-mail.</p>
          <label htmlFor={`minor-link-${childId}`} className="mt-2 block font-medium">
            Lien
          </label>
          <input id={`minor-link-${childId}`} readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} className="mt-1 block w-full rounded-sm border border-success/30 bg-white px-3 py-2 font-mono text-xs" />
        </div>
      )}
    </div>
  );
}
