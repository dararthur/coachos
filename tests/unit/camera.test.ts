import { describe, expect, it, vi } from "vitest";
import { cameraBlockedByPolicy, cameraPermission, classifyCameraError, openCamera, preferContinuousFocus, releaseStream } from "@/app/checkin/camera";

// Objets simulés : ces tests prouvent la logique du scanner, PAS le fonctionnement d'une caméra physique.
const fakeStream = () => {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track, track] } as unknown as MediaStream, track };
};
const domError = (name: string) => new DOMException("simulé", name);

describe("classement des échecs de getUserMedia", () => {
  it("refus : « bloqué » si la permission est refusée ou inconnue, « fenêtre fermée » si elle reste à demander", () => {
    expect(classifyCameraError("NotAllowedError", "denied")).toBe("denied");
    expect(classifyCameraError("NotAllowedError", null)).toBe("denied");
    expect(classifyCameraError("NotAllowedError", "prompt")).toBe("dismissed");
    expect(classifyCameraError("SecurityError", null)).toBe("denied");
    expect(classifyCameraError("PermissionDeniedError", "denied")).toBe("denied"); // ancien nom (Chrome < 64)
  });
  it("aucune caméra, caméra occupée, erreur inconnue", () => {
    expect(classifyCameraError("NotFoundError", "granted")).toBe("unavailable");
    expect(classifyCameraError("OverconstrainedError", null)).toBe("unavailable");
    expect(classifyCameraError("NotReadableError", "granted")).toBe("busy");
    expect(classifyCameraError("TrackStartError", null)).toBe("busy");
    expect(classifyCameraError("AbortError", null)).toBe("busy");
    expect(classifyCameraError("TypeError", null)).toBe("error");
    expect(classifyCameraError(undefined, null)).toBe("error");
  });
});

describe("ouverture de la caméra", () => {
  it("demande la caméra arrière en préférence (ideal), sans micro", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    await expect(openCamera({ getUserMedia })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
  });
  it("contrainte refusée (OverconstrainedError) : nouvel essai sans contrainte", async () => {
    const { stream } = fakeStream();
    const getUserMedia = vi.fn().mockRejectedValueOnce(domError("OverconstrainedError")).mockResolvedValueOnce(stream);
    await expect(openCamera({ getUserMedia })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
  });
  it("refus, absence ou caméra occupée : l'erreur remonte telle quelle, sans second essai", async () => {
    for (const name of ["NotAllowedError", "NotFoundError", "NotReadableError"]) {
      const getUserMedia = vi.fn().mockRejectedValue(domError(name));
      await expect(openCamera({ getUserMedia })).rejects.toMatchObject({ name });
      expect(getUserMedia).toHaveBeenCalledOnce();
    }
  });
  it("libère toutes les pistes ; tolère un flux absent", () => {
    const { stream, track } = fakeStream();
    releaseStream(stream);
    expect(track.stop).toHaveBeenCalledTimes(2);
    expect(() => releaseStream(null)).not.toThrow();
  });
  it("mise au point continue seulement si la caméra la propose ; jamais bloquante", async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    await preferContinuousFocus({ getCapabilities: () => ({ focusMode: ["manual", "continuous"] }), applyConstraints } as unknown as MediaStreamTrack);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: "continuous" }] });
    const never = vi.fn();
    await preferContinuousFocus({ getCapabilities: () => ({}), applyConstraints: never } as unknown as MediaStreamTrack);
    expect(never).not.toHaveBeenCalled();
    await expect(preferContinuousFocus({ getCapabilities: () => ({ focusMode: ["continuous"] }), applyConstraints: vi.fn().mockRejectedValue(new Error("x")) } as unknown as MediaStreamTrack)).resolves.toBeUndefined();
    await expect(preferContinuousFocus(undefined)).resolves.toBeUndefined();
  });
});

describe("politique du document (Permissions-Policy)", () => {
  it("détecte un document qui interdit la caméra (Chromium : permissionsPolicy ou featurePolicy)", () => {
    expect(cameraBlockedByPolicy({ permissionsPolicy: { allowsFeature: (f: string) => f !== "camera" } })).toBe(true);
    expect(cameraBlockedByPolicy({ featurePolicy: { allowsFeature: () => false } })).toBe(true);
    expect(cameraBlockedByPolicy({ permissionsPolicy: { allowsFeature: () => true } })).toBe(false);
  });
  it("navigateur qui n'expose rien (Safari, Firefox) ou API défaillante : on ne conclut pas au blocage", () => {
    expect(cameraBlockedByPolicy({})).toBe(false);
    expect(cameraBlockedByPolicy(undefined)).toBe(false);
    expect(cameraBlockedByPolicy({ permissionsPolicy: { allowsFeature: () => { throw new Error("x"); } } })).toBe(false);
  });
  it("état de la permission : null si l'API ou le nom « camera » ne sont pas pris en charge", async () => {
    const status = { state: "granted" } as PermissionStatus;
    await expect(cameraPermission({ permissions: { query: vi.fn().mockResolvedValue(status) } })).resolves.toBe(status);
    await expect(cameraPermission({ permissions: { query: vi.fn().mockRejectedValue(new TypeError("camera")) } })).resolves.toBeNull();
    await expect(cameraPermission({})).resolves.toBeNull();
  });
});
