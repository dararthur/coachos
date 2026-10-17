"use client";

import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkinPath, clubCheckinPath, extractCheckinToken, extractClubKey, SCAN_PATH } from "@/domain/checkin";
import { buttonClasses } from "@/components/ui/button-classes";
import { cameraBlockedByPolicy, cameraPermission, classifyCameraError, openCamera, preferContinuousFocus, releaseStream, type CameraProblem } from "./camera";

type Phase = "idle" | "starting" | "scanning" | CameraProblem;
type Platform = "ios" | "android" | "other";

const platformOf = (ua: string): Platform => (/iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "other");

/** Marche à suivre pour débloquer la caméra, selon le téléphone (la caméra native n'est jamais proposée en remplacement). */
const UNBLOCK_STEPS: Record<Platform, string[]> = {
  ios: ["Ouvrez les Réglages de l'iPhone, puis Safari › Caméra.", "Choisissez « Autoriser » ou « Demander ».", "Revenez ici et touchez « Réessayer la caméra »."],
  android: [
    "Dans le navigateur : touchez l'icône à gauche de l'adresse, puis Autorisations › Caméra › Autoriser.",
    "Application installée : appui long sur l'icône Matnexa › Infos sur l'appli › Autorisations › Caméra.",
    "Si Chrome lui-même n'a pas accès à la caméra : Paramètres Android › Applications › Chrome › Autorisations › Caméra.",
    "Revenez ici : le scanner redémarre seul, sinon touchez « Réessayer la caméra ».",
  ],
  other: ["Autorisez la caméra pour ce site dans les réglages du navigateur.", "Revenez ici et touchez « Réessayer la caméra »."],
};

const PROBLEMS: Record<CameraProblem, string> = {
  denied: "L'accès à la caméra est refusé pour Matnexa.",
  dismissed: "La caméra n'a pas été autorisée. Touchez « Réessayer la caméra », puis « Autoriser ».",
  unavailable: "Aucune caméra utilisable sur cet appareil ou dans ce navigateur. Si vous avez ouvert ce lien depuis une autre application (messagerie, réseau social), ouvrez-le dans Chrome ou Safari.",
  busy: "La caméra est déjà utilisée par une autre application. Fermez-la, puis réessayez.",
  insecure: "La caméra n'est disponible que sur une adresse sécurisée (https). Ouvrez Matnexa depuis son adresse habituelle.",
  policy: "Cette page doit être rechargée pour accéder à la caméra.",
  interrupted: "La caméra s'est arrêtée. Touchez « Réessayer la caméra ».",
  error: "La caméra n'a pas pu démarrer. Réessayez ; si le problème persiste, fermez puis rouvrez le navigateur.",
};

const isProblem = (p: Phase): p is CameraProblem => p !== "idle" && p !== "starting" && p !== "scanning";

/** Rechargement unique quand le document interdit la caméra (page ouverte avant une mise à jour du site). */
const RELOAD_MARK = "matnexa-camera-reload";
function reloadOnce(): boolean {
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_MARK) ?? 0) < 30_000) return false;
    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
  } catch {
    return false;
  }
  window.location.replace(SCAN_PATH);
  return true;
}
function clearReloadMark() {
  try {
    sessionStorage.removeItem(RELOAD_MARK);
  } catch {
    // stockage indisponible : sans conséquence
  }
}

/**
 * Scanner : la caméra n'est sollicitée qu'après un geste explicite (bouton ici, ou « Pointer ma présence » ailleurs dans
 * l'application, qui ouvre cette page avec `autoStart`). Le contenu décodé n'est jamais « suivi » aveuglément : seul un
 * jeton ou un lien de CE site vers /checkin/<jeton> est accepté (extractCheckinToken). Aucune image n'est envoyée ni
 * conservée : le décodage se fait entièrement dans le navigateur et le flux est coupé dès qu'un code est lu.
 *
 * Chaque démarrage porte un numéro (`run`) : un arrêt, un démontage ou un nouveau démarrage invalide le précédent, dont le
 * flux éventuellement obtenu plus tard est aussitôt libéré (jamais de caméra allumée « orpheline »).
 */
export function Scanner({ autoStart = false }: { autoStart?: boolean }) {
  const router = useRouter();
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [platform, setPlatform] = useState<Platform>("other");
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number | null>(null);
  const run = useRef(0);
  const pending = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const resumeOnVisible = useRef(false);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /** Invalide le démarrage en cours et libère la caméra. */
  const halt = useCallback(() => {
    run.current++;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    releaseStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  useEffect(() => halt, [halt]);

  const go = useCallback(
    (raw: string): boolean => {
      const key = extractClubKey(raw, window.location.origin);
      const token = key ? null : extractCheckinToken(raw, window.location.origin);
      if (!key && !token) return false;
      halt();
      router.push(key ? clubCheckinPath(key) : checkinPath(token!));
      return true;
    },
    [router, halt],
  );

  const start = useCallback(async () => {
    if (pending.current !== null && pending.current === run.current) return; // double appui pendant le démarrage
    halt();
    const id = run.current;
    const current = () => run.current === id;
    pending.current = id;
    setHint(null);
    setPlatform(platformOf(navigator.userAgent));
    try {
      if (!window.isSecureContext) return setPhase("insecure");
      if (!navigator.mediaDevices?.getUserMedia) return setPhase("unavailable");
      if (cameraBlockedByPolicy(document)) {
        if (reloadOnce()) return;
        return setPhase("policy");
      }
      setPhase("starting");
      let s: MediaStream;
      try {
        s = await openCamera(navigator.mediaDevices);
      } catch (e) {
        const permission = await cameraPermission(navigator);
        if (current()) setPhase(classifyCameraError((e as DOMException | undefined)?.name, permission?.state ?? null));
        return;
      }
      if (!current()) return releaseStream(s); // arrêté, quitté ou relancé pendant la demande d'accès
      stream.current = s;
      const el = video.current;
      if (!el) return halt();
      const track = s.getVideoTracks()[0];
      track?.addEventListener("ended", () => {
        if (!current()) return;
        halt();
        setPhase("interrupted");
      });
      void preferContinuousFocus(track);
      el.srcObject = s;
      try {
        await el.play();
      } catch {
        if (current()) {
          halt();
          setPhase("error");
        }
        return;
      }
      if (!current()) return;
      clearReloadMark();
      setPhase("scanning");

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let last = 0;
      let lastHint = 0;
      const loop = (t: number) => {
        if (!current() || !ctx) return;
        // Piste arrêtée sans événement « ended » (selon le navigateur ou le téléphone, quand une autre application prend la
        // caméra) : on le voit à son état, et on propose de réessayer au lieu de laisser un aperçu figé.
        if (track?.readyState === "ended") {
          halt();
          setPhase("interrupted");
          return;
        }
        frame.current = requestAnimationFrame(loop);
        if (t - last < 120 || el.readyState < 2 || el.videoWidth === 0) return; // ~8 images/s suffisent
        last = t;
        const scale = Math.min(1, 640 / el.videoWidth);
        canvas.width = Math.round(el.videoWidth * scale);
        canvas.height = Math.round(el.videoHeight * scale);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code && !go(code.data) && t - lastHint > 2500) {
          lastHint = t;
          setHint("Ce QR code n'est pas un code de pointage Matnexa.");
        }
      };
      frame.current = requestAnimationFrame(loop);
    } finally {
      if (pending.current === id) pending.current = null;
    }
  }, [go, halt, setPhase]);

  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  // Arrivée depuis « Pointer ma présence » : le geste vient d'être fait, inutile de le redemander. En développement,
  // React démonte/remonte une fois : le premier démarrage est annulé par `halt`, le second aboutit.
  useEffect(() => {
    if (autoStart) void startRef.current();
  }, [autoStart]);

  // Application mise en arrière-plan pendant le scan : on coupe la caméra et on la relance au retour. On ne touche pas à
  // un démarrage en cours (la fenêtre d'autorisation d'Android peut masquer brièvement la page).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (phaseRef.current === "scanning") {
          resumeOnVisible.current = true;
          halt();
          setPhase("idle");
        }
      } else if (resumeOnVisible.current || phaseRef.current === "interrupted") {
        resumeOnVisible.current = false;
        void startRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [halt, setPhase]);

  // Retour depuis les réglages du site après un refus : dès que la caméra est autorisée, le scanner redémarre seul.
  useEffect(() => {
    if (phase !== "denied" && phase !== "dismissed") return;
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => {
      if (status?.state === "granted" && document.visibilityState === "visible") void startRef.current();
    };
    void cameraPermission(navigator).then((s) => {
      if (cancelled || !s) return;
      status = s;
      s.addEventListener("change", onChange);
    });
    return () => {
      cancelled = true;
      status?.removeEventListener("change", onChange);
    };
  }, [phase]);

  function retry() {
    if (phaseRef.current === "policy") window.location.replace(SCAN_PATH);
    else void start();
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    if (!go(manual)) setManualError("Lien ou code non reconnu. Collez le lien de pointage complet, tel qu'il s'affiche sous le QR code.");
  }

  const failed = isProblem(phase);
  return (
    <div className="space-y-5">
      <section aria-labelledby="scan-title" className="rounded-sm border border-line bg-surface p-5" data-testid="scanner" data-phase={phase}>
        <h2 id="scan-title" className="text-base font-semibold">
          Scanner le QR code du cours
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-soft">
          Celui de l&apos;affiche du club ou de l&apos;écran du coach. Votre téléphone demandera l&apos;accès à la caméra : touchez « Autoriser ». Aucune image n&apos;est envoyée ni enregistrée.
        </p>

        {phase === "idle" || failed ? (
          <button type="button" className={buttonClasses({ className: "w-full sm:w-auto" })} onClick={retry}>
            {phase === "policy" ? "Recharger la page" : failed ? "Réessayer la caméra" : "Scanner un QR code"}
          </button>
        ) : null}

        {failed && (
          <div role="alert" className="mt-3 rounded-sm border border-warning/35 bg-warning-soft px-3 py-2.5 text-sm text-warning-ink" data-testid="camera-problem" data-phase={phase}>
            <p className="font-semibold">{PROBLEMS[phase]}</p>
            {phase === "denied" && (
              <ol className="mt-1.5 list-decimal space-y-1 pl-5">
                {UNBLOCK_STEPS[platform].map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        )}

        <div className={phase === "scanning" || phase === "starting" ? "mt-3" : "hidden"}>
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-sm bg-ink">
            <video ref={video} className="h-full w-full object-cover" playsInline muted aria-label="Aperçu de la caméra" />
            {phase === "starting" && (
              <p className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center text-sm text-white">
                <span className="font-semibold">Démarrage de la caméra…</span>
                <span className="text-bar-muted">Si le téléphone le demande, touchez « Autoriser ».</span>
              </p>
            )}
          </div>
          <p className="mt-2 text-center text-sm text-ink-soft" aria-live="polite">
            {hint ?? "Cadrez le QR code de l'affiche ou de l'écran du coach."}
          </p>
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              className={buttonClasses({ variant: "secondary" })}
              onClick={() => {
                resumeOnVisible.current = false;
                halt();
                setPhase("idle");
              }}
            >
              Arrêter la caméra
            </button>
          </div>
        </div>
      </section>

      <section aria-labelledby="fallback-title" className="rounded-sm border border-line bg-surface p-5">
        <h2 id="fallback-title" className="text-base font-semibold">
          La caméra ne fonctionne pas ?
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Visez le QR avec l&apos;appareil photo de votre téléphone et touchez le lien qui apparaît : il ouvre directement la confirmation de votre présence. Sinon, signalez-vous au coach au début du cours : il vous marque présent à l&apos;appel.
        </p>
        <details className="mt-3">
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline decoration-ink/40 underline-offset-[3px] hover:decoration-ink">
            J&apos;ai un lien de pointage
          </summary>
          <form onSubmit={submitManual} className="mt-2 space-y-3">
            <div>
              <label htmlFor="manual-link" className="mb-1.5 block text-sm font-semibold">
                Lien ou code de pointage
              </label>
              <input
                id="manual-link"
                name="link"
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                aria-invalid={manualError ? true : undefined}
                aria-describedby={manualError ? "manual-hint manual-error" : "manual-hint"}
                className="field"
              />
              <p id="manual-hint" className="mt-1.5 text-sm text-ink-soft">
                Le lien qui s&apos;affiche sous le QR code, copié tel quel.
              </p>
              {manualError && (
                <p id="manual-error" role="alert" className="mt-1.5 text-sm font-semibold text-danger">
                  {manualError}
                </p>
              )}
            </div>
            <button type="submit" className={buttonClasses({ variant: "secondary" })}>
              Continuer
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
