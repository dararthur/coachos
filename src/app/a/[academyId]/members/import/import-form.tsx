"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { Alert, Card, DataTable } from "@/components/ui/ui";
import { buttonClasses } from "@/components/ui/button-classes";
import { importMembersAction, type ImportReport } from "@/server/actions/members";
import type { ActionResult } from "@/domain/errors";
import type { RowIssue } from "@/domain/csv-import";

function IssueList({ title, issues, tone }: { title: string; issues: RowIssue[]; tone: "danger" | "warning" | "info" }) {
  if (issues.length === 0) return null;
  return (
    <Alert tone={tone} title={`${title} (${issues.length}${issues.length >= 50 ? "+" : ""})`}>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {issues.slice(0, 20).map((i) => (
          <li key={`${i.line}-${i.messages[0]}`}>
            Ligne {i.line} : {i.messages.join(" ")}
          </li>
        ))}
        {issues.length > 20 && <li>… et {issues.length - 20} autre(s).</li>}
      </ul>
    </Alert>
  );
}

/**
 * Étape 1 « Analyser » (aucune écriture) puis étape 2 « Importer » (revalidation complète côté serveur).
 * Le fichier est conservé dans l'état du composant : un envoi par FormData manuel évite la réinitialisation
 * automatique des champs de formulaire de React 19.
 */
export function ImportForm({ academyId }: { academyId: string }) {
  const [state, run, pending] = useActionState(importMembersAction.bind(null, academyId), null as ActionResult<ImportReport> | null);
  const [file, setFile] = useState<File | null>(null);
  const [adult, setAdult] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const submit = (mode: "preview" | "commit") => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mode", mode);
    if (adult) fd.set("adultConfirmed", "on");
    startTransition(() => run(fd));
  };

  const report = state?.ok ? state.data : null;
  const committed = report?.mode === "commit" && !report.fatal;
  const canCommit = report?.mode === "preview" && !report.fatal && report.toCreate > 0;

  return (
    <div className="space-y-4">
      <Card title="1. Choisir le fichier">
        <div className="space-y-3">
          <div>
            <label htmlFor="csv-file" className="mb-1.5 block text-sm font-semibold">
              Fichier CSV
            </label>
            <input
              id="csv-file"
              ref={input}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="field"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-describedby={state && !state.ok ? "csv-error" : undefined}
            />
            {state && !state.ok && (
              <p id="csv-error" role="alert" className="mt-2 text-sm font-semibold text-danger">
                {state.fieldErrors?.file ?? state.fieldErrors?.adultConfirmed ?? state.error}
              </p>
            )}
          </div>
          <button type="button" className={buttonClasses({ variant: "secondary" })} disabled={!file || pending} onClick={() => submit("preview")}>
            {pending && !report ? "Analyse…" : "Analyser le fichier"}
          </button>
        </div>
      </Card>

      <div aria-live="polite">
        {report?.fatal && (
          <Alert tone="danger" title="Fichier refusé">
            {report.fatal}
          </Alert>
        )}

        {report && !report.fatal && (
          <Card title={committed ? "Import terminé" : "2. Vérifier puis importer"}>
            {committed ? (
              <Alert tone="success">
                {report.created} membre{report.created > 1 ? "s" : ""} importé{report.created > 1 ? "s" : ""}.{" "}
                {report.totalRows - report.created > 0 && `${report.totalRows - report.created} ligne(s) ignorée(s) (invalides ou déjà présentes).`}{" "}
                <a href={`/a/${academyId}/members`}>Voir les membres</a>
              </Alert>
            ) : (
              <p className="mb-3 text-sm">
                <strong>{report.totalRows}</strong> ligne(s) lue(s) · <strong>{report.toCreate}</strong> à créer · {report.invalid.length} invalide(s) · {report.duplicatesInFile.length} doublon(s) dans le fichier · {report.skippedExisting.length} déjà présent(s).
              </p>
            )}
            {report.ignoredColumns.length > 0 && (
              <Alert tone="info" title="Colonnes ignorées (non conservées)">
                {report.ignoredColumns.join(", ")}
              </Alert>
            )}
            <IssueList title="Lignes invalides (non importées)" issues={report.invalid} tone="danger" />
            <IssueList title="Doublons dans le fichier (ignorés)" issues={report.duplicatesInFile} tone="warning" />
            <IssueList title="Déjà présents dans le club (ignorés)" issues={report.skippedExisting} tone="warning" />
            <IssueList title="Homonymes possibles (importés quand même)" issues={report.possibleHomonyms} tone="info" />

            {!committed && report.sample.length > 0 && (
              <div className="-mx-4 mb-4 border-y border-line sm:-mx-5">
                <DataTable bare caption="Aperçu des premiers membres à créer" headers={["Ligne", "Prénom", "Nom", "E-mail", "Inscription", "Identifiant"]}>
                  {report.sample.map((r) => (
                    <tr key={r.line}>
                      <td className="px-4 py-2">{r.line}</td>
                      <td className="px-4 py-2">{r.firstName}</td>
                      <td className="px-4 py-2">{r.lastName}</td>
                      <td className="px-4 py-2">{r.email ?? "—"}</td>
                      <td className="px-4 py-2">{r.joinedOn ?? "—"}</td>
                      <td className="px-4 py-2">{r.externalRef ?? "—"}</td>
                    </tr>
                  ))}
                </DataTable>
              </div>
            )}

            {canCommit && (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <input id="adult" type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-1 size-5 accent-ink" aria-describedby={state?.ok === false ? "adult-error" : undefined} />
                  <label htmlFor="adult" className="text-sm">
                    Je certifie que tous les membres de ce fichier sont majeurs et que le club est en droit de traiter leurs données.
                  </label>
                </div>
                <button type="button" className={buttonClasses()} disabled={!adult || pending} onClick={() => submit("commit")}>
                  {pending ? "Import en cours…" : `Importer ${report.toCreate} membre${report.toCreate > 1 ? "s" : ""}`}
                </button>
              </div>
            )}
            {report.mode === "preview" && report.toCreate === 0 && <Alert tone="warning">Aucun membre à créer dans ce fichier.</Alert>}
          </Card>
        )}
      </div>
    </div>
  );
}
