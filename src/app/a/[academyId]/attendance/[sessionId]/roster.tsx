"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeCheckinAction, getRollSnapshotAction, issueCheckinTokenAction, openCheckinAction, validateRollAction,
  type IssuedToken, type RollSnapshot,
} from "@/server/actions/checkin";
import { markRemainingPresentAction, setAttendanceAction } from "@/server/actions/schedule";
import { CHECKIN_REFRESH_SECONDS, CHECKIN_TOKEN_TTL_SECONDS, ROLL_POLL_INTERVAL_MS, remainingSeconds } from "@/domain/checkin";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/domain/validation";
import { buttonClasses } from "@/components/ui/button-classes";
import { ConfirmAction } from "@/components/ui/confirm";
import { Badge, Card, EmptyState } from "@/components/ui/ui";

const STATUSES: AttendanceStatus[] = ["present", "late", "absent"];
type Entry = RollSnapshot["entries"][number];

const clock = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Feuille d'appel + pointage par QR. Principes de fiabilité :
 *  - chaque action est confirmée par la base avant d'être affichée comme enregistrée ;
 *  - en cas d'erreur réseau l'état n'est jamais « supposé » : on le dit, puis on resynchronise depuis la base ;
 *  - la liste est actualisée toutes les quelques secondes (et au retour du réseau / de l'onglet) ; un instantané plus
 *    ancien qu'une modification locale est ignoré pour éviter les retours en arrière.
 */
export function Roster({ academyId, sessionId, initial, editable, capacity, qrAllowed }: { academyId: string; sessionId: string; initial: RollSnapshot; editable: boolean; capacity: number | null; qrAllowed: boolean }) {
  const [entries, setEntries] = useState<Entry[]>(initial.entries);
  const [checkin, setCheckin] = useState(initial.checkin);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [sync, setSync] = useState<{ ok: boolean; at: number }>({ ok: true, at: initial.serverNow });
  const pending = useRef(new Set<string>());
  const lastMutation = useRef(0);

  const apply = useCallback((snap: RollSnapshot) => {
    setEntries((prev) => snap.entries.map((e) => (pending.current.has(e.personId) ? (prev.find((p) => p.personId === e.personId) ?? e) : e)));
    setCheckin(snap.checkin);
    setSync({ ok: true, at: Date.now() });
  }, []);

  const refresh = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const r = await getRollSnapshotAction(academyId, sessionId);
      if (startedAt < lastMutation.current) return; // instantané antérieur à une modification locale : on le jette
      if (r.ok) apply(r.data);
      else setSync((s) => ({ ok: false, at: s.at }));
    } catch {
      setSync((s) => ({ ok: false, at: s.at }));
    }
  }, [academyId, sessionId, apply]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const id = setInterval(tick, ROLL_POLL_INTERVAL_MS);
    window.addEventListener("online", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || `${e.lastName} ${e.firstName}`.toLowerCase().includes(q)) : entries;
  }, [entries, query]);

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, none: 0, qr: 0 };
    for (const e of entries) {
      c[e.status ?? "none"]++;
      if (e.source === "qr") c.qr++;
    }
    return c;
  }, [entries]);

  async function choose(personId: string, next: AttendanceStatus | null) {
    const previous = entries.find((e) => e.personId === personId)?.status ?? null;
    if (previous === next) return;
    setBusy(personId);
    setMessage(null);
    pending.current.add(personId);
    try {
      const result = await setAttendanceAction(academyId, { sessionId, personId, status: next ?? "none" });
      if (result.ok) setEntries((list) => list.map((e) => (e.personId === personId ? { ...e, status: result.data.status, source: result.data.status ? "manual" : null } : e)));
      else setMessage({ tone: "error", text: result.error });
    } catch {
      // Erreur réseau : on ne sait pas si l'écriture a eu lieu. On le dit, puis on relit la base. Réessayer est sans risque (idempotent).
      setMessage({ tone: "error", text: "Connexion perdue : l'enregistrement n'est pas confirmé. Vérifiez l'état affiché puis réessayez." });
    } finally {
      pending.current.delete(personId);
      lastMutation.current = Date.now();
      setBusy(null);
      void refresh();
    }
  }

  async function markAll() {
    setMessage(null);
    lastMutation.current = Date.now();
    try {
      const result = await markRemainingPresentAction(academyId, { sessionId });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
      } else {
        const n = result.data.marked;
        setMessage({ tone: "ok", text: `${n} membre${n > 1 ? "s" : ""} marqué${n > 1 ? "s" : ""} présent${n > 1 ? "s" : ""}.` });
      }
    } catch {
      setMessage({ tone: "error", text: "Connexion perdue : l'opération n'est pas confirmée. L'état affiché est relu depuis la base." });
    } finally {
      lastMutation.current = Date.now();
      void refresh();
    }
  }

  if (entries.length === 0 && !qrAllowed) {
    return <EmptyState title="Aucun membre actif">Ajoutez ou importez des membres pour faire l&apos;appel.</EmptyState>;
  }

  const attended = counts.present + counts.late;
  const rollEditable = editable;
  return (
    <div className="space-y-6">
      {qrAllowed && <CheckinPanel academyId={academyId} sessionId={sessionId} checkin={checkin} qrCount={counts.qr} onSnapshot={(s) => { lastMutation.current = Date.now(); apply(s); }} onRefresh={refresh} />}

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
          {rollEditable && (
            <button type="button" className={buttonClasses({ variant: "secondary" })} onClick={markAll} disabled={counts.none === 0}>
              Marquer les non renseignés présents
            </button>
          )}
        </div>

        <div role="status" aria-live="polite" className="empty:hidden">
          {!sync.ok && (
            <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="sync-lost">
              Connexion perdue — liste figée à {clock(sync.at)}. Les modifications ne sont pas enregistrées tant que la connexion n&apos;est pas revenue.
            </p>
          )}
          {message && (
            <p className={`mb-3 rounded-lg border px-3 py-2 text-sm ${message.tone === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`} role={message.tone === "error" ? "alert" : undefined}>
              {message.text}
            </p>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="text-sm text-muted">{entries.length === 0 ? "Aucun membre actif." : `Aucun membre ne correspond à « ${query} ».`}</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
            {visible.map((e) => (
              <li key={e.personId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 font-medium">
                  {e.lastName.toUpperCase()} {e.firstName}
                  {e.archived && <span className="ml-2 text-xs font-normal text-muted">(archivé)</span>}
                  {e.source === "qr" && (
                    <span className="ml-2 align-middle">
                      <Badge tone="brand">Pointé par QR</Badge>
                    </span>
                  )}
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
                        disabled={!rollEditable || busy === e.personId}
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
        {rollEditable && <p className="mt-3 text-xs text-muted">Cliquez à nouveau sur le statut actif pour effacer l&apos;enregistrement. Un pointage par QR peut être corrigé à tout moment.</p>}
      </div>
    </div>
  );
}

// --- Pointage par QR (côté coach) ----------------------------------------------------------------
function CheckinPanel({
  academyId, sessionId, checkin, qrCount, onSnapshot, onRefresh,
}: {
  academyId: string;
  sessionId: string;
  checkin: RollSnapshot["checkin"];
  qrCount: number;
  onSnapshot: (s: RollSnapshot) => void;
  onRefresh: () => Promise<void>;
}) {
  const [token, setToken] = useState<(IssuedToken & { offset: number }) | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [now, setNow] = useState(0);
  const isOpen = checkin.status === "open" && !checkin.validatedAt;

  // Renouvellement du QR tant que le pointage est ouvert : un nouveau jeton bien avant l'expiration du précédent.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const issue = async () => {
      try {
        const r = await issueCheckinTokenAction(academyId, sessionId);
        if (cancelled) return;
        if (r.ok) {
          setToken({ ...r.data, offset: r.data.serverNow - Date.now() });
          setNow(Date.now());
          setTokenError(null);
          // Renouvellement à mi-vie du jeton (au plus CHECKIN_REFRESH_SECONDS) : toujours un QR valide à l'écran.
          const lifetime = r.data.expiresAt - r.data.serverNow;
          timer = setTimeout(issue, Math.max(2_000, Math.min(CHECKIN_REFRESH_SECONDS * 1000, lifetime / 2)));
        } else {
          setTokenError(r.error);
          timer = setTimeout(issue, r.code === "checkin_closed" ? 30_000 : 6_000);
          if (r.code === "checkin_closed") void onRefresh();
        }
      } catch {
        if (cancelled) return;
        setTokenError("Connexion perdue : le QR code ne peut pas être renouvelé. Nouvelle tentative…");
        timer = setTimeout(issue, 5_000);
      }
    };
    void issue();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, academyId, sessionId, onRefresh]);

  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isOpen]);

  async function run(fn: () => ReturnType<typeof openCheckinAction>) {
    setWorking(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) {
        if (!(r.data.checkin.status === "open")) setToken(null);
        onSnapshot(r.data);
      } else setError(r.error);
    } catch {
      setError("Connexion perdue : l'opération n'est pas confirmée. L'état affiché est relu depuis la base.");
      void onRefresh();
    } finally {
      setWorking(false);
    }
  }

  const remaining = token ? remainingSeconds(token.expiresAt, now + token.offset) : 0;
  const ttl = CHECKIN_TOKEN_TTL_SECONDS;
  const live = isOpen && token !== null && remaining > 0;

  return (
    <Card title="Pointage par QR code" description="Les adhérents scannent ce QR code avec leur téléphone pour enregistrer eux-mêmes leur présence. Vous gardez la main sur la feuille.">
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </p>
      )}

      {checkin.validatedAt ? (
        <div className="space-y-3">
          <p className="text-sm">
            <Badge tone="success">Feuille validée</Badge> le {clock(checkin.validatedAt)}. Le pointage est clos.
          </p>
          <button type="button" className={buttonClasses({ variant: "secondary" })} disabled={working} onClick={() => run(() => validateRollAction(academyId, sessionId, false))}>
            Rouvrir la feuille
          </button>
        </div>
      ) : !isOpen ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">Le pointage est fermé : aucun adhérent ne peut pointer.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClasses()} disabled={working} onClick={() => run(() => openCheckinAction(academyId, sessionId))}>
              {working ? "Ouverture…" : "Ouvrir le pointage"}
            </button>
            <ValidateButton academyId={academyId} sessionId={sessionId} onSnapshot={onSnapshot} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            <div className="relative w-64 max-w-full">
              {token ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR en data URI généré par le serveur
                <img src={token.qr} alt="QR code de pointage pour cette séance" width={256} height={256} className={`aspect-square w-full rounded-lg border border-line bg-white p-1 ${live ? "" : "opacity-30"}`} />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-muted" role="status">
                  Génération du QR code…
                </div>
              )}
            </div>
            <div className="min-w-0 flex-[1_1_16rem] space-y-3">
              <p className="text-sm" data-testid="qr-countdown">
                {live ? (
                  <>
                    QR code valide encore <strong className="tabular-nums">{remaining} s</strong> — il se renouvelle automatiquement.
                  </>
                ) : (
                  "QR code expiré : renouvellement en cours…"
                )}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-label="Validité du QR code" aria-valuemin={0} aria-valuemax={ttl} aria-valuenow={Math.min(remaining, ttl)}>
                <div className="h-full rounded-full bg-brand-600 transition-[width] duration-1000 ease-linear" ref={(el) => { if (el) el.style.width = `${Math.round((Math.min(remaining, ttl) / ttl) * 100)}%`; }} />
              </div>
              {tokenError && (
                <p role="alert" className="text-sm text-red-800">
                  {tokenError}
                </p>
              )}
              <p className="text-sm text-muted" aria-live="polite">
                <strong className="text-ink">{qrCount}</strong> adhérent{qrCount > 1 ? "s" : ""} pointé{qrCount > 1 ? "s" : ""} par QR.
              </p>
              {token && (
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer py-2 font-medium">Lien de pointage (si le scan est impossible)</summary>
                  <label htmlFor="checkin-link" className="mt-2 block text-muted">
                    Valable quelques secondes, à ne partager qu&apos;aux adhérents présents.
                  </label>
                  <input id="checkin-link" readOnly value={token.url} onFocus={(e) => e.currentTarget.select()} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs" />
                </details>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClasses({ variant: "secondary" })} disabled={working} onClick={() => run(() => closeCheckinAction(academyId, sessionId))}>
              Fermer le pointage
            </button>
            <ValidateButton academyId={academyId} sessionId={sessionId} onSnapshot={onSnapshot} />
          </div>
        </div>
      )}
    </Card>
  );
}

function ValidateButton({ academyId, sessionId, onSnapshot }: { academyId: string; sessionId: string; onSnapshot: (s: RollSnapshot) => void }) {
  return (
    <ConfirmAction
      action={async () => {
        try {
          const r = await validateRollAction(academyId, sessionId, true);
          if (r.ok) onSnapshot(r.data);
          return r;
        } catch {
          return { ok: false as const, code: "internal" as const, error: "Connexion perdue : la validation n'est pas confirmée. Réessayez." };
        }
      }}
      trigger="Valider la feuille d'appel"
      title="Valider la feuille d'appel ?"
      description={<p>La validation ferme le pointage par QR et invalide les QR codes affichés. Vous pourrez encore corriger des présences, ou rouvrir la feuille.</p>}
      confirmLabel="Valider la feuille"
      triggerVariant="secondary"
      confirmVariant="primary"
    />
  );
}
