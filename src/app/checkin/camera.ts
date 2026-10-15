/**
 * Accès caméra du scanner : logique sans React, testable avec de faux objets (tests/unit/camera.test.ts).
 * Rien n'est envoyé ni conservé : ces fonctions ouvrent un flux local et classent les échecs pour l'affichage.
 */

/** Pourquoi la caméra n'a pas démarré : chaque cas a son message et sa marche à suivre (scanner.tsx). */
export type CameraProblem =
  /** Refus enregistré pour ce site (ou bloqué par le système) : il faut le changer dans les réglages. */
  | "denied"
  /** Fenêtre d'autorisation fermée ou refusée une fois : un nouvel essai la redemande. */
  | "dismissed"
  /** Aucune caméra, ou navigateur sans accès caméra (navigateur intégré d'une autre application). */
  | "unavailable"
  /** Caméra déjà utilisée par une autre application, ou matériel indisponible. */
  | "busy"
  /** Page servie hors https : les navigateurs n'exposent pas la caméra. */
  | "insecure"
  /** Le document courant interdit la caméra (Permissions-Policy) et un rechargement n'a pas suffi. */
  | "policy"
  /** Flux interrompu en cours de scan (application mise en arrière-plan, autre application). */
  | "interrupted"
  | "error";

/** Classe une erreur de getUserMedia. `permission` = état lu par l'API Permissions juste après l'échec (null si inconnu). */
export function classifyCameraError(name: string | undefined, permission: PermissionState | null): CameraProblem {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      // Chrome : « prompt » après un refus = fenêtre fermée ou refus ponctuel ; « denied » = bloqué pour le site.
      return permission === "prompt" ? "dismissed" : "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "unavailable";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "error";
  }
}

/**
 * Ouvre la caméra arrière si possible. `facingMode` est une préférence (`ideal`) ; si le navigateur refuse quand même la
 * contrainte (OverconstrainedError sur certains appareils), on réessaie sans contrainte plutôt que d'abandonner.
 */
export async function openCamera(md: Pick<MediaDevices, "getUserMedia">): Promise<MediaStream> {
  try {
    return await md.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  } catch (e) {
    if ((e as DOMException | undefined)?.name !== "OverconstrainedError") throw e;
    return md.getUserMedia({ video: true, audio: false });
  }
}

/** Mise au point continue si la caméra la propose (QR tenu près de l'objectif). Sans effet ailleurs, jamais bloquant. */
export async function preferContinuousFocus(track: MediaStreamTrack | undefined): Promise<void> {
  try {
    const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { focusMode?: string[] }) | undefined;
    if (caps?.focusMode?.includes("continuous")) await track!.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] });
  } catch {
    // réglage facultatif
  }
}

interface PolicyLike {
  allowsFeature?: (feature: string) => boolean;
}

/**
 * true si le DOCUMENT courant interdit la caméra (Permissions-Policy, figée au chargement de la page). Seul Chromium
 * expose cette information (`permissionsPolicy` / `featurePolicy`) ; ailleurs on ne sait pas et on renvoie false.
 */
export function cameraBlockedByPolicy(doc: unknown): boolean {
  const d = doc as { permissionsPolicy?: PolicyLike; featurePolicy?: PolicyLike } | undefined;
  const policy = d?.permissionsPolicy ?? d?.featurePolicy;
  if (typeof policy?.allowsFeature !== "function") return false;
  try {
    return !policy.allowsFeature("camera");
  } catch {
    return false;
  }
}

/** Lit l'état de la permission caméra (null si l'API ou le nom « camera » ne sont pas pris en charge, ex. Firefox). */
export async function cameraPermission(nav: { permissions?: Pick<Permissions, "query"> }): Promise<PermissionStatus | null> {
  try {
    return (await nav.permissions?.query({ name: "camera" as PermissionName })) ?? null;
  } catch {
    return null;
  }
}

/** Arrête toutes les pistes d'un flux (libère la caméra et éteint son voyant). */
export function releaseStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
