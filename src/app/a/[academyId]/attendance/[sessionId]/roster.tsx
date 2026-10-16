"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  closeCheckinAction, getRollSnapshotAction, issueCheckinTokenAction, openCheckinAction, validateRollAction,
  type IssuedToken, type RollSnapshot,
} from "@/server/actions/checkin";
import { promoteBookingAction } from "@/server/actions/bookings";
import { markRemainingPresentAction, setAttendanceAction } from "@/server/actions/schedule";
import { CHECKIN_REFRESH_SECONDS, CHECKIN_TOKEN_TTL_SECONDS, ROLL_POLL_INTERVAL_MS, remainingSeconds } from "@/domain/checkin";
import { ATTENDANCE_LABELS, type AttendanceStatus } from "@/domain/validation";
import { buttonClasses } from "@/components/ui/button-classes";
import { ConfirmAction } from "@/components/ui/confirm";
import { Icon } from "@/components/ui/icons";
import { Badge, Card, EmptyState } from "@/components/ui/ui";
import { Avatar } from "@/components/ui/avatar";
import { BeltIcon } from "@/components/ui/belt";

const STATUSES: AttendanceStatus[] = ["present", "late", "absent"];
type Entry = RollSnapshot["entries"][number];
/** Vue de la liste : tous, seulement les non renseignés (l'appel se vide au fil des gestes), ou seulement les marqués. */
type View = "all" | "booked" | "todo" | "done";
const ACTIVE_TONE: Record<AttendanceStatus, string> = {
  present: "border-success bg-success text-white",
  late: "border-warning bg-warning text-white",
  absent: "border-danger bg-danger text-white",
};

const clock = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Feuille d'appel + pointage par QR. Principes de fiabilité :
 *  - chaque action est confirmée par la base avant d'être affichée comme enregistrée ;
 *  - en cas d'erreur réseau l'état n'est jamais « supposé » : on le dit, puis on resynchronise depuis la base ;
 *  - la liste est actualisée toutes les quelques secondes (et au retour du réseau / de l'onglet) ; un instantané plus
 *    ancien qu'une modification locale est ignoré pour éviter les retours en arrière.
 */
export function Roster({ academyId, sessionId, initial, editable, capacity, qrAllowed, fixedQr }: { academyId: string; sessionId: string; initial: RollSnapshot; editable: boolean; capacity: number | null; qrAllowed: boolean; fixedQr?: { before: number; after: number } | null }) {
  const [entries, setEntries] = useState<Entry[]>(initial.entries);
  const [checkin, setCheckin] = useState(initial.checkin);
  const [query, setQuery] = useState("");
  // Par défaut, les inscrits (ceux que le coach attend) ; la liste complète reste à un appui quand personne ne s'est inscrit.
  const [view, setView] = useState<View>(initial.entries.some((e) => e.booking !== null) ? "booked" : "all");
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
    return entries.filter(
      (e) =>
        (view === "all" || (view === "booked" ? e.booking !== null : view === "todo" ? e.status === null : e.status !== null)) &&
        (!q || `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) || `${e.lastName} ${e.firstName}`.toLowerCase().includes(q)),
    );
  }, [entries, query, view]);

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, none: 0, qr: 0, booked: 0, waitlisted: 0, noShows: 0 };
    for (const e of entries) {
      c[e.status ?? "none"]++;
      if (e.booking === "booked") {
        c.booked++;
        if (e.status === null) c.noShows++;
      }
      if (e.booking === "waitlisted") c.waitlisted++;
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

  async function promote(personId: string) {
    setBusy(personId);
    setMessage(null);
    try {
      const result = await promoteBookingAction(academyId, { sessionId, personId });
      if (result.ok) setEntries((list) => list.map((e) => (e.personId === personId ? { ...e, booking: "booked" } : e)));
      else setMessage({ tone: "error", text: result.error });
    } catch {
      setMessage({ tone: "error", text: "Connexion perdue : l'opération n'est pas confirmée. Vérifiez l'état affiché." });
    } finally {
      lastMutation.current = Date.now();
      setBusy(null);
      void refresh();
    }
  }

  // Appelée depuis une confirmation (ConfirmAction) : le résultat ferme la fenêtre ou y affiche l'erreur.
  // Sous le filtre « Inscrits », l'action groupée ne touche que les inscrits : elle ne marque jamais tout le club à l'insu du coach.
  const bulkBooked = view === "booked";
  const bulkCount = bulkBooked ? counts.noShows : counts.none;

  async function markAll() {
    setMessage(null);
    lastMutation.current = Date.now();
    try {
      const result = await markRemainingPresentAction(academyId, { sessionId, onlyBooked: bulkBooked });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
      } else {
        const n = result.data.marked;
        setMessage({ tone: "ok", text: `${n} membre${n > 1 ? "s" : ""} marqué${n > 1 ? "s" : ""} présent${n > 1 ? "s" : ""}.` });
      }
      return result;
    } catch {
      const text = "Connexion perdue : l'opération n'est pas confirmée. L'état affiché est relu depuis la base.";
      setMessage({ tone: "error", text });
      return { ok: false as const, code: "internal" as const, error: text };
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
  const onSnapshot = (s: RollSnapshot) => {
    lastMutation.current = Date.now();
    apply(s);
  };
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {qrAllowed && fixedQr && (
        <aside className="lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <section aria-labelledby="fixed-qr-title" className="rounded-sm border border-line bg-surface px-3 py-2 sm:px-4 sm:py-3">
            <h2 id="fixed-qr-title" className="flex items-center gap-2 text-sm font-bold sm:text-base">
              <Icon name="qr" size={18} />
              Pointage par QR fixe
            </h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              Ouvert de {fixedQr.before} min avant à {fixedQr.after} min après le début, sans action de votre part. {counts.qr} par QR.
            </p>
          </section>
        </aside>
      )}
      {qrAllowed && !fixedQr && (
        <aside className="lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
          <CheckinPanel academyId={academyId} sessionId={sessionId} checkin={checkin} qrCount={counts.qr} onSnapshot={onSnapshot} onRefresh={refresh} />
        </aside>
      )}

      <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="roster-search" className="mb-1.5 block text-sm font-semibold">
              Filtrer la liste
            </label>
            <input id="roster-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom ou prénom" className="field" />
          </div>
          {/* Petits téléphones (360 px et moins) : 2 × 2, sinon le dernier filtre sortait de l'écran. */}
          <div role="group" aria-label="Afficher" className="grid w-full grid-cols-2 rounded-sm border border-line-strong bg-surface p-0.5 sm:flex sm:w-auto">
            {(
              [
                ["all", `Tous ${entries.length}`],
                ["booked", `Inscrits ${counts.booked + counts.waitlisted}`],
                ["todo", `À marquer ${counts.none}`],
                ["done", `Marqués ${entries.length - counts.none}`],
              ] as const
            ).map(([v, label]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-11 rounded-xs px-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${view === v ? "bg-ink text-white" : "text-ink-soft hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Action groupée en tête de liste : atteignable sans faire défiler tout l'effectif. */}
          {rollEditable && bulkCount > 0 && (view === "booked" || view === "all" || view === "todo") && (
            <ConfirmAction
              action={markAll}
              trigger={bulkBooked ? `Marquer les ${bulkCount} inscrit${bulkCount > 1 ? "s" : ""} présent${bulkCount > 1 ? "s" : ""}` : "Marquer tout le monde présent"}
              triggerClassName="w-full sm:w-auto"
              title={bulkBooked ? `Marquer ${bulkCount} inscrit${bulkCount > 1 ? "s" : ""} présent${bulkCount > 1 ? "s" : ""} ?` : `Marquer ${bulkCount} membre${bulkCount > 1 ? "s" : ""} présent${bulkCount > 1 ? "s" : ""} ?`}
              description={
                bulkBooked ? (
                  <p>Les inscrits pas encore marqués seront enregistrés présents (pas ceux de la liste d&apos;attente). Vous pourrez corriger chaque ligne ensuite.</p>
                ) : (
                  <p>
                    <strong>Tous les membres actifs du club</strong> pas encore marqués seront enregistrés présents, y compris ceux qui ne sont pas venus. Pour ne marquer que les inscrits, choisissez d&apos;abord le filtre « Inscrits ».
                  </p>
                )
              }
              confirmLabel="Marquer présents"
              confirmVariant="primary"
            />
          )}
        </div>

        {visible.length === 0 ? (
          <p className="rounded-sm border border-line bg-surface px-4 py-6 text-center text-sm text-ink-soft">
            {entries.length === 0 ? "Aucun membre actif." : query ? `Aucun membre ne correspond à « ${query} ».` : view === "booked" ? "Personne ne s'est inscrit à cette séance." : view === "todo" ? "Tout le monde est renseigné." : "Personne n'est encore marqué."}
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-sm border border-line bg-surface">
            {visible.map((e) => (
              <li key={e.personId} className={`grid gap-2 px-3 py-2.5 min-[30rem]:flex min-[30rem]:items-center min-[30rem]:justify-between min-[30rem]:gap-4 sm:px-4 ${busy === e.personId ? "opacity-60" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                <Avatar academyId={academyId} personId={e.personId} avatarStyle={e.avatarStyle} hasPhoto={e.hasPhoto} size="sm" />
                <div className="min-w-28">
                  <p className="break-words font-semibold leading-tight">
                    <span className="uppercase">{e.lastName}</span> {e.firstName}
                    {e.archived && <span className="ml-2 text-xs font-normal text-ink-soft">(archivé)</span>}
                  </p>
                  {(e.booking === "booked" || e.source === "qr" || e.belt) && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5">
                      {e.belt && <BeltIcon belt={e.belt} stripes={e.beltStripes} size="sm" />}
                      {e.booking === "booked" && <Badge tone="success">Inscrit</Badge>}
                      {e.source === "qr" && <Badge tone="brand">Pointé par QR</Badge>}
                    </p>
                  )}
                  {e.booking === "waitlisted" && (
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone="warning">Liste d&apos;attente</Badge>
                      {rollEditable && (
                        <button type="button" className="min-h-11 text-sm font-semibold underline underline-offset-[3px] disabled:opacity-60" disabled={busy === e.personId} onClick={() => promote(e.personId)}>
                          Accorder une place
                        </button>
                      )}
                    </p>
                  )}
                </div>
                </div>
                <div role="group" aria-label={`Présence de ${e.firstName} ${e.lastName}`} className="grid grid-cols-3 gap-1 min-[30rem]:flex min-[30rem]:shrink-0">
                  {STATUSES.map((s) => {
                    const active = e.status === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={active}
                        disabled={!rollEditable || busy === e.personId}
                        onClick={() => choose(e.personId, active ? null : s)}
                        className={`min-h-11 rounded-sm border px-3 text-sm font-semibold transition-colors duration-100 disabled:cursor-not-allowed sm:min-w-20 ${active ? ACTIVE_TONE[s] : "border-line-strong bg-surface text-ink hover:border-ink disabled:text-ink-soft"}`}
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
        {rollEditable && <p className="mt-3 text-xs text-ink-soft">Touchez à nouveau le statut actif pour effacer l&apos;enregistrement. Un pointage par QR peut être corrigé à tout moment.</p>}
        <div className="sticky bottom-[var(--tabbar-h)] z-20 -mx-4 mt-4 border-t border-line bg-canvas px-4 pb-3 pt-2.5 sm:mx-0 sm:rounded-sm sm:border sm:bg-surface sm:px-4">
          <div role="status" aria-live="polite" className="empty:hidden">
            {!sync.ok && (
              <p className="mb-2 rounded-sm border border-warning/35 bg-warning-soft px-3 py-2 text-sm font-medium text-warning-ink" data-testid="sync-lost">
                Connexion perdue — liste figée à {clock(sync.at)}. Les modifications ne sont pas enregistrées tant que la connexion n&apos;est pas revenue.
              </p>
            )}
            {message && (
              <p className={`mb-2 rounded-sm border px-3 py-2 text-sm font-medium ${message.tone === "error" ? "border-danger/30 bg-danger-soft text-danger-ink" : "border-success/30 bg-success-soft text-success-ink"}`} role={message.tone === "error" ? "alert" : undefined}>
                {message.text}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <RollProgress counts={counts} total={entries.length} />
              <p className="mt-1.5 text-sm" aria-live="polite">
                <strong>{attended}</strong> présent{attended > 1 ? "s" : ""}
                {capacity ? ` / ${capacity} places` : ""} · {counts.absent} absent{counts.absent > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-ink-soft">
                {counts.booked} inscrit{counts.booked > 1 ? "s" : ""}
                {counts.noShows > 0 ? ` dont ${counts.noShows} pas encore marqué${counts.noShows > 1 ? "s" : ""}` : ""}
                {counts.waitlisted > 0 ? ` · ${counts.waitlisted} en liste d'attente` : ""}
              </p>
            </div>
            {qrAllowed && !checkin.validatedAt && <ValidateButton academyId={academyId} sessionId={sessionId} onSnapshot={onSnapshot} noShows={counts.noShows} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Progression de l'appel : la ceinture se remplit (présents, retards, absents), le reste est encore à marquer. Attributs SVG : compatible CSP. */
function RollProgress({ counts, total }: { counts: { present: number; late: number; absent: number }; total: number }) {
  const parts = [
    { n: counts.present, cls: "fill-success" },
    { n: counts.late, cls: "fill-warning" },
    { n: counts.absent, cls: "fill-danger" },
  ];
  let x = 0;
  return (
    <svg viewBox={`0 0 ${Math.max(1, total)} 1`} preserveAspectRatio="none" className="block h-2 w-full rounded-xs bg-line" aria-hidden="true" focusable="false">
      {parts.map((p) => {
        const rect = p.n > 0 ? <rect key={p.cls} x={x} y="0" width={p.n} height="1" className={p.cls} /> : null;
        x += p.n;
        return rect;
      })}
    </svg>
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

  // Pointage fermé : une seule ligne, pour que la liste des membres arrive tout de suite sous le titre.
  if (!isOpen && !checkin.validatedAt) {
    return (
      <section aria-labelledby="checkin-title" className="rounded-sm border border-line bg-surface px-3 py-1.5 sm:px-4 sm:py-3">
        {error && (
          <p role="alert" className="mb-3 rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-x-4">
          <div className="min-w-0">
            <h2 id="checkin-title" className="text-sm font-bold sm:text-base">
              Pointage par QR code
            </h2>
            <p className="hidden text-sm text-ink-soft sm:block">Fermé : les adhérents ne peuvent pas pointer.</p>
          </div>
          <button type="button" className={buttonClasses({ variant: "secondary", className: "shrink-0" })} disabled={working} onClick={() => run(() => openCheckinAction(academyId, sessionId))}>
            <Icon name="qr" size={18} />
            {working ? (
              "Ouverture…"
            ) : (
              <span>
                Ouvrir<span className="sr-only sm:not-sr-only"> le pointage</span>
              </span>
            )}
          </button>
        </div>
      </section>
    );
  }

  const remaining = token ? remainingSeconds(token.expiresAt, now + token.offset) : 0;
  const ttl = CHECKIN_TOKEN_TTL_SECONDS;
  const live = isOpen && token !== null && remaining > 0;

  return (
    <Card title="Pointage par QR code" description={isOpen ? "Montrez cet écran : chaque adhérent le vise avec l'appareil photo de son téléphone (ou l'onglet « Pointer » de Matnexa) et confirme sa présence. Vous gardez la main sur la feuille." : undefined}>
      {error && (
        <p role="alert" className="mb-3 rounded-sm border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">
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
      ) : (
        <div className="space-y-4">
          <div className="space-y-4">
            <div className="relative mx-auto w-full max-w-72">
              {token ? (
                // eslint-disable-next-line @next/next/no-img-element -- QR en data URI généré par le serveur
                <img src={token.qr} alt="QR code de pointage pour cette séance" width={256} height={256} className={`aspect-square w-full rounded-sm border border-line bg-white p-1 transition-opacity ${live ? "" : "opacity-30"}`} />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-sm border border-line bg-sunken text-sm text-ink-soft" role="status">
                  Génération du QR code…
                </div>
              )}
            </div>
            <div className="min-w-0 space-y-3">
              <p className="text-sm" data-testid="qr-countdown">
                {live ? (
                  <>
                    QR code valide encore <strong className="tabular-nums">{remaining} s</strong> — il se renouvelle automatiquement.
                  </>
                ) : (
                  "QR code expiré : renouvellement en cours…"
                )}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-xs bg-line" role="progressbar" aria-label="Validité du QR code" aria-valuemin={0} aria-valuemax={ttl} aria-valuenow={Math.min(remaining, ttl)}>
                <div className="h-full bg-ink transition-[width] duration-1000 ease-linear" ref={(el) => { if (el) el.style.width = `${Math.round((Math.min(remaining, ttl) / ttl) * 100)}%`; }} />
              </div>
              {tokenError && (
                <p role="alert" className="text-sm font-semibold text-danger">
                  {tokenError}
                </p>
              )}
              <p className="text-sm text-ink-soft" aria-live="polite">
                <strong className="text-ink">{qrCount}</strong> adhérent{qrCount > 1 ? "s" : ""} pointé{qrCount > 1 ? "s" : ""} par QR.
              </p>
              {token && (
                <details className="text-sm">
                  <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Lien de pointage (si le scan est impossible)</summary>
                  <label htmlFor="checkin-link" className="mt-1 block text-ink-soft">
                    Valable quelques secondes, à ne partager qu&apos;aux adhérents présents.
                  </label>
                  <input id="checkin-link" readOnly value={token.url} onFocus={(e) => e.currentTarget.select()} className="field mt-1.5 font-mono" />
                </details>
              )}
            </div>
          </div>
          <button type="button" className={buttonClasses({ variant: "secondary", className: "w-full" })} disabled={working} onClick={() => run(() => closeCheckinAction(academyId, sessionId))}>
            Fermer le pointage
          </button>
        </div>
      )}
    </Card>
  );
}

function ValidateButton({ academyId, sessionId, onSnapshot, noShows }: { academyId: string; sessionId: string; onSnapshot: (s: RollSnapshot) => void; noShows: number }) {
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
      trigger={
        <>
          <span>
            Valider<span className="sr-only sm:not-sr-only"> la feuille d&apos;appel</span>
          </span>
        </>
      }
      title="Valider la feuille d'appel ?"
      description={
        <>
          <p>La validation ferme le pointage par QR et invalide les QR codes affichés. Les réservations ne pourront plus être annulées. Vous pourrez encore corriger des présences, ou rouvrir la feuille.</p>
          {noShows > 0 && (
            <p className="mt-2 font-semibold">
              {noShows} inscrit{noShows > 1 ? "s" : ""} sans présence enregistrée {noShows > 1 ? "seront marqués absents" : "sera marqué absent"}.
            </p>
          )}
        </>
      }
      confirmLabel="Valider la feuille"
      triggerVariant="primary"
      confirmVariant="primary"
    />
  );
}
