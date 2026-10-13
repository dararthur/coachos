import { expect, randomIp, test } from "./support/helpers";

// NB : ce fichier s'exécute AVANT security.spec.ts (ordre alphabétique) : la route /api/auth est donc appelée avant la première connexion par
// Server Action. C'est la séquence qui révélait que `instanceof APIError` échouait (deux copies du paquet) : security.spec.ts vérifie ensuite
// que « mot de passe incorrect » et la limite de débit restent bien reconnus (voir src/server/auth/api-error.ts).

test.describe("en-têtes de cache sur les réponses sensibles", () => {
  test("toute réponse de /api/auth (liens d'e-mail portant des jetons, cookies) est no-store, y compris les redirections et les erreurs", async ({ request }) => {
    const headers = () => ({ "x-real-ip": randomIp() });
    for (const p of [
      "/api/auth/ok",
      "/api/auth/verify-email?token=inconnu&callbackURL=%2Flogin",
      "/api/auth/reset-password/inconnu?callbackURL=%2Freset-password",
      "/api/auth/verify-email?token=inconnu&callbackURL=https%3A%2F%2Fevil.example%2F", // 403 : l'erreur aussi
      "/api/auth/sign-in/email", // 404 : chemin fermé
    ]) {
      const res = await request.get(p, { headers: headers(), maxRedirects: 0 });
      expect(res.headers()["cache-control"], p).toMatch(/no-store/);
      expect(res.headers()["pragma"], p).toBe("no-cache");
    }
  });

  test("les pages qui lisent la session ou un jeton dans l'URL ne sont jamais mises en cache ; liveness et santé non plus", async ({ request }) => {
    for (const p of ["/login", "/reset-password?token=abc", "/reset-password?error=INVALID_TOKEN", "/api/live", "/api/health"]) {
      const res = await request.get(p, { headers: { "x-real-ip": randomIp() } });
      expect(res.headers()["cache-control"], p).toMatch(/no-store|no-cache|private/);
      expect(res.headers()["cache-control"], p).not.toMatch(/s-maxage|public/);
    }
  });

  test("aucun HSTS dans la pile de test (http) : émis uniquement par une instance déployée en https", async ({ request }) => {
    const res = await request.get("/login", { headers: { "x-real-ip": randomIp() } });
    expect(res.headers()["strict-transport-security"]).toBeUndefined();
  });
});
