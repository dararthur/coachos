import type { LaunchOptions, Page } from "@playwright/test";
import { test } from "./helpers";

/**
 * Caméra SIMULÉE selon le moteur du projet Playwright (chromium, firefox, webkit) :
 * - Chromium : --use-fake-device-for-media-stream (motif de test) et --use-fake-ui-for-media-stream (pas de fenêtre d'autorisation) ;
 * - Firefox : les préférences équivalentes media.navigator.streams.fake / media.navigator.permission.disabled ;
 * - WebKit : aucun réglage de lancement ; la permission « camera » est accordée par le contexte (cameraPermissions), et la
 *   caméra factice n'existe que si la version de WebKit de Playwright en a une (voir cameraUnsupported).
 */
export function fakeCameraLaunch(browserName: string, launchOptions: LaunchOptions, chromiumArgs: string[] = []): LaunchOptions {
  if (browserName === "chromium")
    return { ...launchOptions, args: [...(launchOptions.args ?? []), "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...chromiumArgs] };
  if (browserName === "firefox")
    return { ...launchOptions, firefoxUserPrefs: { ...launchOptions.firefoxUserPrefs, "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } };
  return launchOptions;
}

/** Permission caméra accordée d'avance. Firefox n'a pas de permission « camera » dans Playwright : ses préférences en tiennent lieu. */
export const cameraPermissions = (browserName: string): string[] => (browserName === "firefox" ? [] : ["camera"]);

/**
 * Raison de NE PAS lancer un test qui a besoin d'un vrai flux caméra, ou null si le moteur en fournit un. Sondé sur une page du
 * site (contexte sécurisé, permissions du contexte), par un appel getUserMedia BRUT, indépendant du code de l'application :
 * un échec ici est une limite du navigateur de test, pas un défaut du scanner. Chromium doit TOUJOURS fournir sa caméra simulée
 * (jamais de saut). Constaté le 2026-10-16 : WebKit de Playwright pour Windows n'expose pas navigator.mediaDevices.
 */
export async function cameraUnsupported(page: Page, browserName: string): Promise<string | null> {
  if (browserName === "chromium") return null;
  if (!/^https?:/.test(page.url())) await page.goto("/login");
  const result = await page.evaluate(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return "navigator.mediaDevices absent";
    try {
      const s = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("getUserMedia sans réponse après 5 s")), 5000)),
      ]);
      const live = s.getVideoTracks().some((t) => t.readyState === "live");
      s.getTracks().forEach((t) => t.stop());
      return live ? null : "aucune piste vidéo active";
    } catch (e) {
      return `getUserMedia : ${(e as Error).name} ${(e as Error).message}`;
    }
  });
  return result && `${browserName} de Playwright ne fournit pas de caméra simulée ici (${result}) : à vérifier sur un appareil réel`;
}

/** Saute le test (raison affichée dans le rapport) si le moteur ne fournit pas de flux caméra ; ferme alors le contexte. */
export async function skipWithoutCamera(page: Page, browserName: string): Promise<void> {
  const why = await cameraUnsupported(page, browserName);
  if (!why) return;
  await page.context().close();
  test.skip(true, why);
}

/**
 * Remplace getUserMedia par le flux d'un <canvas> où est dessiné `image` (un QR), pour les moteurs sans fichier vidéo de caméra
 * simulée (Firefox, WebKit). Le flux passe ensuite par le vrai chemin du scanner : <video>, drawImage, getImageData, jsQR.
 * Renvoie la raison de ne pas lancer le test si le moteur ne sait pas filmer un canvas (captureStream absent).
 */
export async function canvasCamera(page: Page, pngDataUrl: string): Promise<string | null> {
  await page.context().addInitScript((src) => {
    const md = navigator.mediaDevices;
    // Trace lue par le diagnostic des tests en cas d'échec (moteur non reproductible en local).
    const trace = { installed: false, calls: 0, error: null as string | null };
    (window as unknown as { __canvasCam: typeof trace }).__canvasCam = trace;
    if (!md || typeof HTMLCanvasElement.prototype.captureStream !== "function") return;
    const fake = async () => {
      trace.calls++;
      try {
        return await film();
      } catch (e) {
        trace.error = `${(e as Error).name}: ${(e as Error).message}`;
        throw e;
      }
    };
    const film = async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      // Rattaché au document et peint (presque invisible) : WebKit ne fournit pas d'images pour un canvas détaché.
      // Styles par CSSOM : la CSP de l'application interdit les attributs style.
      Object.assign(canvas.style, { position: "fixed", left: "0", top: "0", width: "64px", height: "48px", opacity: "0.02", pointerEvents: "none", zIndex: "-1" });
      (document.body ?? document.documentElement).appendChild(canvas);
      const ctx = canvas.getContext("2d")!;
      const draw = () => {
        ctx.fillStyle = "#ebebeb";
        ctx.fillRect(0, 0, 640, 480);
        ctx.drawImage(img, 120, 40, 400, 400);
      };
      draw();
      const stream = canvas.captureStream(10);
      const timer = setInterval(draw, 100); // une image régulière : certains moteurs n'émettent rien sur un canvas figé
      stream.getVideoTracks()[0]?.addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
    // Sur l'instance ET sur le prototype : selon le moteur, l'un peut masquer l'autre.
    Object.defineProperty(md, "getUserMedia", { value: fake, configurable: true, writable: true });
    Object.defineProperty(Object.getPrototypeOf(md), "getUserMedia", { value: fake, configurable: true, writable: true });
    trace.installed = md.getUserMedia === fake;
  }, pngDataUrl);
  const ok = await page.evaluate(() => !!navigator.mediaDevices && typeof HTMLCanvasElement.prototype.captureStream === "function");
  return ok ? null : "ce moteur ne sait pas filmer un canvas (navigator.mediaDevices ou captureStream absent) : à vérifier sur un appareil réel";
}
