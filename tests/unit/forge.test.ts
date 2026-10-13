import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { forgeLastCharWeakly, forgeToken } from "../support/forge";

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");
function jwt(i: number): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ email: `u${i}@example.invalid`, iat: i }));
  return `${head}.${body}.${createHmac("sha256", randomBytes(16)).update(`${head}.${body}`).digest("base64url")}`;
}
const sig = (t: string) => Buffer.from(t.split(".")[2]!, "base64url");

describe("falsification de jetons dans les tests", () => {
  it("modifie TOUJOURS la signature décodée d'un JWT HS256 (5 000 jetons aléatoires)", () => {
    for (let i = 0; i < 5000; i++) {
      const t = jwt(i);
      const f = forgeToken(t);
      expect(f).not.toBe(t);
      expect(f.split(".").slice(0, 2)).toEqual(t.split(".").slice(0, 2)); // en-tête et corps intacts : seule la signature change
      expect(sig(f).equals(sig(t)), `jeton #${i}`).toBe(false);
    }
  });

  it("contrôle négatif : l'ancienne méthode laissait ≈ 6 % des signatures inchangées (d'où l'instabilité)", () => {
    let unchanged = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      const t = jwt(i);
      if (sig(forgeLastCharWeakly(t)).equals(sig(t))) unchanged++;
    }
    expect(unchanged / n).toBeGreaterThan(0.03);
    expect(unchanged / n).toBeLessThan(0.1);
  });

  it("modifie un jeton opaque (réinitialisation) et reste de même longueur", () => {
    for (let i = 0; i < 1000; i++) {
      const t = randomBytes(18).toString("base64url");
      const f = forgeToken(t);
      expect(f).not.toBe(t);
      expect(f).toHaveLength(t.length);
    }
  });
});
