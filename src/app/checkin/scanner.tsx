"use client";

import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkinPath, extractCheckinToken } from "@/domain/checkin";
import { buttonClasses } from "@/components/ui/button-classes";

type Phase = "idle" | "starting" | "scanning" | "denied" | "unavailable" | "error";

const MESSAGES: Record<Exclude<Phase, "idle" | "starting" | "scanning">, string> = {
  denied: "L'accès à la caméra a été refusé. Autorisez-le dans les réglages du navigateur, ou utilisez l'une des solutions ci-dessous.",
  unavailable: "Aucune caméra utilisable sur cet appareil ou ce navigateur. Utilisez l'application Appareil photo du téléphone (le lien s'ouvrira dans votre navigateur, où il faudra peut-être vous reconnecter), ou saisissez le lien ci-dessous.",
  error: "La caméra n'a pas pu démarrer. Réessayez, ou utilisez l'une des solutions ci-dessous.",
};

/**
 * Scanner : la caméra n'est sollicitée qu'après un clic explicite. Le contenu décodé n'est jamais « suivi » aveuglément :
 * seul un jeton ou un lien de CE site vers /checkin/<jeton> est accepté (extractCheckinToken). Aucune image n'est
 * envoyée ni conservée : le décodage se fait entièrement dans le navigateur et le flux est coupé dès qu'un code est lu.
 */
export function Scanner() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number | null>(null);
  const done = useRef(false);

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
      const token = extractCheckinToken(raw, window.location.origin);
      if (!token) return false;
      done.current = true;
      stop();
      router.push(checkinPath(token));
      return true;
    },
    [router, stop],
  );

  async function start() {
    done.current = false;
    setHint(null);
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
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    setManualError(null);
    if (!go(manual)) setManualError("Lien ou code non reconnu. Collez le lien de pointage affiché par le coach.");
  }

  const failed = phase === "denied" || phase === "unavailable" || phase === "error";
  return (
    <div className="space-y-5">
      <section aria-labelledby="scan-title" className="rounded-sm border border-line bg-surface p-5">
        <h2 id="scan-title" className="text-base font-semibold">
          Scanner le QR code du coach
        </h2>
        <p className="mb-4 mt-1 text-sm text-ink-soft">La caméra ne s&apos;active qu&apos;après votre accord. Aucune image n&apos;est envoyée ni enregistrée.</p>

        {phase === "idle" || failed ? (
          <button type="button" className={buttonClasses({ className: "w-full sm:w-auto" })} onClick={start}>
            {failed ? "Réessayer la caméra" : "Scanner un QR code"}
          </button>
        ) : null}

        {failed && (
          <p role="alert" className="mt-3 rounded-sm border border-warning/35 bg-warning-soft px-3 py-2 text-sm text-warning-ink" data-testid="camera-problem" data-phase={phase}>
            {MESSAGES[phase]}
          </p>
        )}

        <div className={phase === "scanning" || phase === "starting" ? "mt-3" : "hidden"}>
          <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-sm bg-ink">
            <video ref={video} className="h-full w-full object-cover" playsInline muted aria-label="Aperçu de la caméra" />
            {phase === "starting" && <p className="absolute inset-0 flex items-center justify-center text-sm text-white">Démarrage de la caméra…</p>}
          </div>
          <p className="mt-2 text-center text-sm text-ink-soft" aria-live="polite">
            {hint ?? "Cadrez le QR code affiché par le coach."}
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

      <section aria-labelledby="manual-title" className="rounded-sm border border-line bg-surface p-5">
        <h2 id="manual-title" className="text-base font-semibold">
          Pas de caméra ? Saisir le lien
        </h2>
        <p className="mb-3 mt-1 text-sm text-ink-soft">
          Scannez le QR code avec l&apos;appareil photo du téléphone : le lien s&apos;ouvre dans le navigateur, où il faudra peut-être vous reconnecter. Ou collez ci-dessous le lien affiché par le coach.
        </p>
        <form onSubmit={submitManual} className="space-y-3">
          <div>
            <label htmlFor="manual-link" className="mb-1 block text-sm font-medium">
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
              aria-describedby={manualError ? "manual-error" : undefined}
              className="block min-h-11 w-full rounded-sm border border-line-strong bg-white px-3 py-2 text-base"
            />
            {manualError && (
              <p id="manual-error" role="alert" className="mt-1 text-sm font-medium text-danger-ink">
                {manualError}
              </p>
            )}
          </div>
          <button type="submit" className={buttonClasses({ variant: "secondary" })}>
            Continuer
          </button>
        </form>
      </section>
    </div>
  );
}
