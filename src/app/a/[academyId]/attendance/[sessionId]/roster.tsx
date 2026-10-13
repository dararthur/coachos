"use client";

import { useMemo, useState, useTransition } from "react";
import { markRemainingPresentAction, setAttendanceAction } from "@/server/actions/schedule";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/domain/validation";
import { buttonClasses } from "@/components/ui/button-classes";
import { EmptyState } from "@/components/ui/ui";

interface Entry {
  personId: string;
  firstName: string;
  lastName: string;
  status: AttendanceStatus | null;
  archived: boolean;
}

const STATUSES: AttendanceStatus[] = ["present", "late", "absent"];

/**
 * Feuille d'appel. Chaque clic est confirmé par la base (Server Action) avant d'être affiché comme enregistré :
 * en cas d'échec l'état précédent est restauré et l'erreur est annoncée.
 */
export function Roster({ academyId, sessionId, initial, editable, capacity }: { academyId: string; sessionId: string; initial: Entry[]; editable: boolean; capacity: number | null }) {
  const [entries, setEntries] = useState(initial);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || `${e.lastName} ${e.firstName}`.toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, none: 0 };
    for (const e of entries) c[e.status ?? "none"]++;
    return c;
  }, [entries]);

  function choose(personId: string, next: AttendanceStatus | null) {
    const previous = entries.find((e) => e.personId === personId)?.status ?? null;
    if (previous === next) return;
    setBusy(personId);
    setMessage(null);
    startTransition(async () => {
      const result = await setAttendanceAction(academyId, { sessionId, personId, status: next ?? "none" });
      if (result.ok) {
        setEntries((list) => list.map((e) => (e.personId === personId ? { ...e, status: result.data.status } : e)));
      } else {
        setMessage({ tone: "error", text: result.error });
      }
      setBusy(null);
    });
  }

  function markAll() {
    setMessage(null);
    startTransition(async () => {
      const result = await markRemainingPresentAction(academyId, { sessionId });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setEntries((list) => list.map((e) => (e.status === null && !e.archived ? { ...e, status: "present" } : e)));
      setMessage({ tone: "ok", text: `${result.data.marked} membre${result.data.marked > 1 ? "s" : ""} marqué${result.data.marked > 1 ? "s" : ""} présent${result.data.marked > 1 ? "s" : ""}.` });
    });
  }

  if (entries.length === 0) {
    return <EmptyState title="Aucun membre actif">Ajoutez ou importez des membres pour faire l&apos;appel.</EmptyState>;
  }

  const attended = counts.present + counts.late;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="roster-search" className="mb-1 block text-sm font-medium">
            Filtrer la liste
          </label>
          <input id="roster-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou prénom" className="block min-h-11 w-64 max-w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
        </div>
        <p className="text-sm" aria-live="polite">
          <strong>{attended}</strong> présent{attended > 1 ? "s" : ""}
          {capacity ? ` / ${capacity} places` : ""} · {counts.absent} absent{counts.absent > 1 ? "s" : ""} · {counts.none} non renseigné{counts.none > 1 ? "s" : ""}
        </p>
        {editable && (
          <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={markAll} disabled={pending || counts.none === 0}>
            Marquer les non renseignés présents
          </button>
        )}
      </div>

      <div role="status" aria-live="polite" className="empty:hidden">
        {message && (
          <p className={`mb-3 rounded-lg border px-3 py-2 text-sm ${message.tone === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`} role={message.tone === "error" ? "alert" : undefined}>
            {message.text}
          </p>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted">Aucun membre ne correspond à « {query} ».</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          {visible.map((e) => (
            <li key={e.personId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <p className="min-w-0 font-medium">
                {e.lastName.toUpperCase()} {e.firstName}
                {e.archived && <span className="ml-2 text-xs font-normal text-muted">(archivé)</span>}
              </p>
              <div role="group" aria-label={`Présence de ${e.firstName} ${e.lastName}`} className="flex gap-1">
                {STATUSES.map((s) => {
                  const active = e.status === s;
                  const tone = s === "absent" ? "bg-red-700 text-white" : s === "late" ? "bg-amber-600 text-white" : "bg-brand-600 text-white";
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={active}
                      disabled={!editable || busy === e.personId}
                      onClick={() => choose(e.personId, active ? null : s)}
                      className={`min-h-11 min-w-20 rounded-lg px-3 text-sm font-semibold ring-1 ring-slate-300 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? `${tone} ring-0` : "bg-white text-ink hover:bg-slate-50"}`}
                    >
                      {ATTENDANCE_LABELS[s]}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable && <p className="mt-3 text-xs text-muted">Cliquez à nouveau sur le statut actif pour effacer l&apos;enregistrement.</p>}
    </div>
  );
}
