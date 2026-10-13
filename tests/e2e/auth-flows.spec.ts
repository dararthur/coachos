import { randomUUID } from "node:crypto";
import { createClub, expect, logIn, mailsTo, PASSWORD, randomIp, test, uniqueEmail, waitForMail } from "./support/helpers";
import type { Page } from "@playwright/test";

const NEW_PASSWORD = `e2e-nouveau-${randomUUID()}`; // jetable, généré à chaque exécution
const SESSION_COOKIE = /better-auth\.session_token/;

async function register(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Nom affiché").fill("Flux Auth");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Compte créé.")).toBeVisible();
}

async function confirmAndLogIn(page: Page, email: string) {
  const mail = await waitForMail(email, "verification");
  await page.goto(mail.link);
  await logIn(page, email, "/onboarding");
  await expect(page).toHaveURL(/\/onboarding/);
}

test.describe("authentification auto-hébergée : inscription, confirmation, récupération", () => {
  test("inscription : connexion refusée avant confirmation ; lien valide ; rejeu sans effet ; lien falsifié refusé", async ({ page, context }) => {
    const email = uniqueEmail("flux");
    await register(page, email);

    // Avant confirmation : refus explicite, aucune session.
    await logIn(page, email);
    await expect(page.getByRole("alert").filter({ hasText: "Confirmez d'abord votre adresse e-mail." })).toBeVisible();
    expect((await context.cookies()).some((c) => SESSION_COOKIE.test(c.name))).toBe(false);

    // Lien falsifié : refusé, compte toujours non confirmé.
    const mail = await waitForMail(email, "verification");
    const forged = new URL(mail.link);
    const token = forged.searchParams.get("token")!;
    forged.searchParams.set("token", token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"));
    await page.goto(forged.toString());
    await expect(page.getByRole("alert").filter({ hasText: "invalide ou a expiré" })).toBeVisible();
    await expect(page.getByText("Adresse e-mail confirmée")).toHaveCount(0);
    await logIn(page, email);
    await expect(page.getByRole("alert").filter({ hasText: "Confirmez d'abord" })).toBeVisible();

    // Lien valide : confirmation, JAMAIS de connexion automatique.
    await page.goto(mail.link);
    await expect(page).toHaveURL(/\/login\?verified=1/);
    await expect(page.getByText("Adresse e-mail confirmée")).toBeVisible();
    expect((await context.cookies()).some((c) => SESSION_COOKIE.test(c.name))).toBe(false);

    // Rejeu du lien : aucune session ouverte, aucun effet.
    await page.goto(mail.link);
    expect((await context.cookies()).some((c) => SESSION_COOKIE.test(c.name))).toBe(false);

    await logIn(page, email, "/onboarding");
    await expect(page).toHaveURL(/\/onboarding/);
    const cookie = (await context.cookies()).find((c) => SESSION_COOKIE.test(c.name))!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  });

  test("mot de passe oublié : réponse neutre, un seul e-mail, lien à usage unique, anciennes sessions révoquées", async ({ browser }) => {
    const ctxA = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const ctxB = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    const email = uniqueEmail("oubli");
    await register(a, email);
    await confirmAndLogIn(a, email);
    await createClub(a, "Club Oubli");
    await logIn(b, email); // second appareil connecté
    await expect(b).toHaveURL(/\/(a\/|academies|onboarding)/);

    // Réponse identique pour une adresse inconnue : aucun e-mail envoyé.
    const unknown = uniqueEmail("fantome");
    const neutral = "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé.";
    await a.context().clearCookies();
    await a.goto("/forgot-password");
    await a.getByLabel("Adresse e-mail").fill(unknown);
    await a.getByRole("button", { name: "Envoyer le lien" }).click();
    await expect(a.getByText(neutral)).toBeVisible();
    await a.goto("/forgot-password");
    await a.getByLabel("Adresse e-mail").fill(email);
    await a.getByRole("button", { name: "Envoyer le lien" }).click();
    await expect(a.getByText(neutral)).toBeVisible();
    const mail = await waitForMail(email, "password_reset");
    expect(mailsTo(unknown)).toHaveLength(0);

    // Lien falsifié : page « Lien invalide ».
    const forged = new URL(mail.link);
    forged.pathname = forged.pathname.slice(0, -1) + (forged.pathname.endsWith("A") ? "B" : "A");
    await a.goto(forged.toString());
    await expect(a.getByRole("heading", { name: "Lien invalide" })).toBeVisible();

    // Lien valide : nouveau mot de passe.
    await a.goto(mail.link);
    await expect(a.getByRole("heading", { name: "Nouveau mot de passe" })).toBeVisible();
    await a.getByLabel("Nouveau mot de passe").fill(NEW_PASSWORD);
    await a.getByLabel("Confirmation").fill(NEW_PASSWORD);
    await a.getByRole("button", { name: "Mettre à jour" }).click();
    await expect(a).toHaveURL(/\/login\?reset=1/);

    // Lien déjà utilisé : refusé.
    await a.goto(mail.link);
    await expect(a.getByRole("heading", { name: "Lien invalide" })).toBeVisible();

    // L'autre appareil est déconnecté ; l'ancien mot de passe ne marche plus ; le nouveau oui.
    await b.goto("/academies");
    await expect(b).toHaveURL(/\/login/);
    await a.goto("/login");
    await a.getByLabel("Adresse e-mail").fill(email);
    await a.getByLabel("Mot de passe").fill(PASSWORD);
    await a.getByRole("button", { name: "Se connecter" }).click();
    await expect(a.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." })).toBeVisible();
    await a.getByLabel("Mot de passe").fill(NEW_PASSWORD);
    await a.getByRole("button", { name: "Se connecter" }).click();
    await expect(a).toHaveURL(/\/(a\/|academies|onboarding)/);
    await ctxA.close();
    await ctxB.close();
  });

  test("changement de mot de passe depuis le compte : mot de passe actuel exigé", async ({ page }) => {
    const email = uniqueEmail("chg");
    await register(page, email);
    await confirmAndLogIn(page, email);
    await createClub(page, "Club Mot de passe");
    await page.goto("/account");
    await page.getByLabel("Mot de passe actuel").fill("mauvais-mot-de-passe-123");
    await page.getByLabel("Nouveau mot de passe").fill(NEW_PASSWORD);
    await page.getByLabel("Confirmation").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Changer le mot de passe" }).click();
    await expect(page.getByText("Mot de passe actuel incorrect.")).toBeVisible();
    await page.getByLabel("Mot de passe actuel").fill(PASSWORD);
    await page.getByLabel("Nouveau mot de passe").fill(NEW_PASSWORD);
    await page.getByLabel("Confirmation").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Changer le mot de passe" }).click();
    await expect(page.getByText("Mot de passe mis à jour.")).toBeVisible();
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account/); // l'appareil courant reste connecté
  });

  test("suppression du compte : l'utilisateur ne peut plus se connecter et son ancienne session est invalide", async ({ page, context }) => {
    const email = uniqueEmail("suppr");
    await register(page, email);
    await confirmAndLogIn(page, email);
    const cookie = (await context.cookies()).find((c) => SESSION_COOKIE.test(c.name))!;
    await page.goto("/account");
    await page.getByRole("button", { name: "Supprimer mon compte" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Adresse e-mail").fill(email);
    await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(page).toHaveURL(/\/login\?deleted=1/);
    await context.clearCookies();
    await context.addCookies([cookie]); // rejeu de l'ancien cookie
    await page.goto("/academies");
    await expect(page).toHaveURL(/\/login/);
    await logIn(page, email);
    await expect(page.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." })).toBeVisible();
  });
});

test.describe("authentification : abus et surface HTTP", () => {
  test("limitation de débit : 10 essais par adresse, puis refus explicite, même avec une IP différente", async ({ browser }) => {
    const target = uniqueEmail("force");
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const page = await ctx.newPage();
    for (let i = 0; i < 10; i++) {
      await page.goto("/login");
      await page.getByLabel("Adresse e-mail").fill(target);
      await page.getByLabel("Mot de passe").fill(`mauvais-mot-de-passe-${i}`);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." })).toBeVisible();
    }
    // Autre « machine » (autre IP) contre la même adresse : bloqué quand même.
    const other = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const p2 = await other.newPage();
    await p2.goto("/login");
    await p2.getByLabel("Adresse e-mail").fill(target);
    await p2.getByLabel("Mot de passe").fill("mauvais-mot-de-passe-x");
    await p2.getByRole("button", { name: "Se connecter" }).click();
    await expect(p2.getByRole("alert").filter({ hasText: "Trop de tentatives" })).toBeVisible();
    await ctx.close();
    await other.close();
  });

  test("surface HTTP : chemins inutilisés désactivés, origine étrangère refusée, aucune fuite dans les réponses d'erreur", async ({ request, baseURL }) => {
    for (const p of ["/api/auth/get-session", "/api/auth/list-accounts", "/api/auth/account-info"]) {
      expect((await request.get(p)).status(), p).toBe(404);
    }
    for (const p of ["sign-in/social", "change-email", "delete-user", "forget-password"]) {
      expect((await request.post(`/api/auth/${p}`, { data: {}, headers: { origin: baseURL! } })).status(), p).toBe(404);
    }
    // Origine étrangère : contrôle CSRF de Better Auth (serveur de production).
    const evil = await request.post("/api/auth/sign-in/email", {
      data: { email: uniqueEmail("evil"), password: "mauvais-mot-de-passe-1" },
      headers: { origin: "https://evil.example", cookie: "better-auth.session_token=x", "x-real-ip": randomIp() },
    });
    expect(evil.status()).toBe(403);
    // Chemins sensibles sans session.
    for (const [p, data] of [["change-password", { currentPassword: "x", newPassword: "yyyyyyyyyyyy" }], ["revoke-sessions", {}], ["update-user", { name: "x" }]] as const) {
      expect((await request.post(`/api/auth/${p}`, { data, headers: { origin: baseURL!, "x-real-ip": randomIp() } })).status(), p).toBe(401);
    }
    // Une inscription invalide ne renvoie ni trace ni SQL.
    const bad = await request.post("/api/auth/sign-up/email", { data: { email: "pas-un-email", password: "court", name: "x" }, headers: { origin: baseURL!, "x-real-ip": randomIp() } });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    const text = await bad.text();
    expect(text).not.toMatch(/select |insert |postgres|at .*\.(js|ts)/i);
  });
});
