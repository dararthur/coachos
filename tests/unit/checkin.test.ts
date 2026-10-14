import { createHash, randomBytes } from "node:crypto";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import {
  CHECKIN_REFRESH_SECONDS, CHECKIN_TOKEN_TTL_SECONDS, checkinPath, extractCheckinToken, isCheckinToken, remainingSeconds,
} from "@/domain/checkin";

const ORIGIN = "https://app.exemple.fr";
const token = () => randomBytes(32).toString("base64url");

describe("jeton de pointage", () => {
  it("32 octets aléatoires => 43 caractères base64url, tous différents", () => {
    const set = new Set(Array.from({ length: 200 }, token));
    expect(set.size).toBe(200);
    for (const t of set) expect(isCheckinToken(t)).toBe(true);
    expect(isCheckinToken("trop-court")).toBe(false);
    expect(isCheckinToken(`${token()}x`)).toBe(false);
    expect(isCheckinToken(`${token().slice(0, 42)}!`)).toBe(false);
    expect(isCheckinToken(undefined)).toBe(false);
  });

  it("le renouvellement du QR est plus rapide que l'expiration (recouvrement de scan)", () => {
    expect(CHECKIN_REFRESH_SECONDS).toBeLessThan(CHECKIN_TOKEN_TTL_SECONDS);
    expect(CHECKIN_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(300);
  });

  it("compte à rebours : jamais négatif, arrondi au supérieur", () => {
    expect(remainingSeconds(10_000, 9_001)).toBe(1);
    expect(remainingSeconds(10_000, 10_000)).toBe(0);
    expect(remainingSeconds(10_000, 20_000)).toBe(0);
  });
});

describe("extraction du jeton d'un contenu scanné ou saisi", () => {
  const t = token();
  it("accepte un jeton nu et le lien de CE site (avec ou sans barre finale, espaces autour)", () => {
    expect(extractCheckinToken(t, ORIGIN)).toBe(t);
    expect(extractCheckinToken(`  ${ORIGIN}${checkinPath(t)}  `, ORIGIN)).toBe(t);
    expect(extractCheckinToken(`${ORIGIN}${checkinPath(t)}/`, ORIGIN)).toBe(t);
  });

  it("refuse tout le reste : autre domaine, autre chemin, schéma exotique, injection, longueur excessive", () => {
    const bad = [
      `https://evil.example${checkinPath(t)}`,
      `https://app.exemple.fr.evil.example${checkinPath(t)}`,
      `http://app.exemple.fr${checkinPath(t)}`, // autre schéma = autre origine
      `${ORIGIN}/login?next=${checkinPath(t)}`,
      `${ORIGIN}/checkin/${t}/../../admin`,
      `${ORIGIN}/checkin/${t}x`,
      `javascript:alert(1)//${checkinPath(t)}`,
      `data:text/html,<script>${t}</script>`,
      `${ORIGIN}/checkin/<script>`,
      "",
      "   ",
      "x".repeat(5000),
      "BEGIN:VCARD\nFN:Alice",
    ];
    for (const b of bad) expect(extractCheckinToken(b, ORIGIN), b.slice(0, 40)).toBeNull();
  });
});

describe("contenu du QR code", () => {
  const t = token();
  const url = `${ORIGIN}${checkinPath(t)}`;

  /** Rend le QR en image RGBA (comme le ferait une caméra) puis le relit avec jsQR, la bibliothèque du scanner. */
  function decode(text: string): string | null {
    const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const scale = 6;
    const quiet = 4;
    const side = (n + quiet * 2) * scale;
    const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!qr.modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = (((y + quiet) * scale + dy) * side + (x + quiet) * scale + dx) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
      }
    }
    return jsQR(rgba, side, side)?.data ?? null;
  }

  it("le QR encode exactement le lien : décodable, aucun identifiant ni donnée personnelle", () => {
    expect(decode(url)).toBe(url);
    const decoded = decode(url)!;
    expect(new URL(decoded).searchParams.size).toBe(0); // pas de paramètre (identifiant, séance, club…)
    expect(decoded.replace(ORIGIN, "").replace("/checkin/", "")).toBe(t);
    expect(decoded).not.toMatch(/@|session|academy|member|user/i);
  });

  it("le scan complet (QR -> jsQR -> extraction) fournit le jeton, et un QR étranger est refusé", () => {
    expect(extractCheckinToken(decode(url)!, ORIGIN)).toBe(t);
    expect(extractCheckinToken(decode("https://evil.example/checkin/" + t)!, ORIGIN)).toBeNull();
    expect(extractCheckinToken(decode("WIFI:S:reseau;T:WPA;P:motdepasse;;")!, ORIGIN)).toBeNull();
  });

  it("le hachage stocké ne permet pas de retrouver le jeton et diffère d'un jeton à l'autre", () => {
    const h = (v: string) => createHash("sha256").update(v).digest("hex");
    expect(h(t)).toHaveLength(64);
    expect(h(t)).not.toContain(t);
    expect(h(t)).not.toBe(h(token()));
  });
});

describe("QR fixe du club", () => {
  const origin = "https://app.exemple.fr";
  const key = "0123456789abcdef01234567";
  it("accepte seulement le lien du club sur ce site", async () => {
    const { extractClubKey, isClubKey, clubCheckinPath } = await import("../../src/domain/checkin");
    expect(isClubKey(key)).toBe(true);
    expect(isClubKey(key.toUpperCase())).toBe(false);
    expect(extractClubKey(`${origin}${clubCheckinPath(key)}`, origin)).toBe(key);
    expect(extractClubKey(`${origin}/checkin/club/${key}/`, origin)).toBe(key);
    expect(extractClubKey(`https://autre.example${clubCheckinPath(key)}`, origin)).toBeNull();
    expect(extractClubKey(`${origin}/checkin/club/${key}x`, origin)).toBeNull();
    expect(extractClubKey(key, origin)).toBeNull();
    expect(extractClubKey("javascript:alert(1)", origin)).toBeNull();
  });
});
