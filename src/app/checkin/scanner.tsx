"use client";

import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkinPath, clubCheckinPath, extractCheckinToken, extractClubKey } from "@/domain/checkin";
import { buttonClasses } from "@/components/ui/button-classes";

type Phase = "idle" | "starting" | "scanning" | "denied" | "unavailable" | "error";
type Platform = "ios" | "android" | "other";

const platformOf = (ua: string): Platform => (/iPhone|iPad|iPod/.test(ua) ? "ios" : /Android/.test(ua) ? "android" : "other");

/** Marche à suivre pour débloquer la caméra, selon le téléphone (la caméra native n'est jamais proposée en remplacement). */
const UNBLOCK_STEPS: Record<Platform, string[]> = {
  ios: ["Ouvrez les Réglages de l'iPhone, puis Safari › Caméra.", "Choisissez « Autoriser » ou « Demander ».", "Revenez ici et touchez « Réessayer la caméra »."],
  android: [
    "Dans le navigateur : touchez l'icône à gauche de l'adresse, puis Autorisations › Caméra › Autoriser.",
    "Application installée : appui long sur l'icône Matnexa › Infos sur l'appli › Autorisations › Caméra.",
    "Revenez ici et touchez « Réessayer la caméra ».",
  ],
  other: ["Autorisez la caméra pour ce site dans les réglages du navigateur.", "Revenez ici et touchez « Réessayer la caméra »."],
};

const PROBLEMS: Record<Exclude<Phase, "idle" | "starting" | "scanning">, string> = {
  denied: "L'accès à la caméra est bloqué.",
  unavailable: "Aucune caméra utilisable sur cet appareil ou dans ce navigateur.",
  error: "La caméra n'a pas pu démarrer. Fermez les autres applications qui l'utilisent, puis réessayez.",
};

/**
 * Scanner : la caméra n'est sollicitée qu'après un geste explicite (bouton ici, ou « Pointer ma présence » ailleurs dans
 * l'application, qui ouvre cette page avec `autoStart`). Le contenu décodé n'est jamais « suivi » aveuglément : seul un
 * jeton ou un lien de CE site vers /checkin/<jeton> est accepté (extractCheckinToken). Aucune image n'est envoyée ni
 * conservée : le décodage se fait entièrement dans le navigateur et le flux est coupé dès qu'un code est lu.
 */
export function Scanner({ autoStart = false }: { autoStart?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [platform, setPlatform] = useState<Platform>("other");
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number | null>(null);
  const done = useRef(false);
  const autoStarted = useRef(false);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  useEffect(() => stop, [stop]);

  const go = useCallback(
    (raw: string): boolean => {
      const key = extractClubKey(raw, window.location.origin);
      const token = key ? null : extractCheckinToken(raw, window.location.origin);
      if (!key && !token) return false;
      done.current = true;
      stop();
      router.push(key ? clubCheckinPath(key) : checkinPath(token!));
      return true;
    },
    [router, stop],
  );

  const start = useCallback(async () => {
    done.current = false;
    setHint(null);
    setPlatform(platformOf(navigator.userAgent));
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("unavailable");
      return;
    }
    setPhase("starting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    } catch (e) {
      const name = (e as DOMException | undefined)?.name;
      setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "unavailable" : "error");
      return;
    }
    const el = video.current;
    if (!el) {
      stop();
      return;
    }
    el.srcObject = stream.current;
    try {
      await el.play();
    } catch {
      stop();
      setPhase("error");
      return;
    }
    setPhase("scanning");

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    let last = 0;
    let lastHint = 0;
    const loop = (t: number) => {
      if (done.current || !ctx) return;
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
  }, [go, stop]);

  // Arrivée depuis « Pointer ma présence » : le geste vient d'être fait, inutile de le redemander (une seule fois, même
  // si React rejoue l'effet en développement).
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void start();
  }, [autoStart, start]);

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    if (!go(manual)) setManualError("Lien ou code non reconnu. Collez le lien de pointage complet, tel qu'il s'affiche sous le QR code.");
  }

  const failed = phase === "denied" || phase === "unavailable" || phase === "error";
  return (
    <div className="space-y-5">
      <section aria-labelledby="scan-title" className="rounded-sm border border-line bg-surface p-5">
        <h2 id="scan-title" className="text-base font-semibold">
          Scanner le QR code du cours
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-soft">
          Celui de l&apos;affiche du club ou de l&apos;écran du coach. Votre téléphone demandera l&apos;accès à la caméra : touchez « Autoriser ». Aucune image n&apos;est envoyée ni enregistrée.
        </p>

        {phase === "idle" || failed ? (
          <button type="button" className={buttonClasses({ className: "w-full sm:w-auto" })} onClick={() => void start()}>
            {failed ? "Réessayer la caméra" : "Scanner un QR code"}
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
                done.current = true;
                stop();
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
        <p className="mt-1 text-sm text-ink-soft">Signalez-vous au coach au début du cours : il vous marque présent à l&apos;appel.</p>
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
