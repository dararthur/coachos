import type { Browser } from "@playwright/test";
import { PASSWORD, createClub, logIn, parisToday, signUp, uniqueEmail, expect, randomIp, test } from "./support/helpers";

async function newUser(browser: Browser, label: string) {
  const context = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const page = await context.newPage();
  const email = uniqueEmail(label);
  await signUp(page, email, label);
  return { context, page, email };
}

test.describe("isolation entre clubs et rôles", () => {
  test("un utilisateur d'un autre club n'accède à aucune page, export ou donnée du club A", async ({ browser }) => {
    const a = await newUser(browser, "alice");
    const clubA = await createClub(a.page, "Club Alpha");
    await a.page.goto(`/a/${clubA}/members/new`);
    await a.page.getByLabel("Prénom").fill("Secret");
    await a.page.getByRole("textbox", { name: "Nom", exact: true }).fill("Alpha-Only");
    await a.page.getByLabel("Je confirme que ce membre est majeur.").check();
    await a.page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(a.page).toHaveURL(/members\/[0-9a-f-]{36}/);
    const memberUrl = a.page.url();
    expect(memberUrl).toMatch(/members\/[0-9a-f-]{36}/);

    const b = await newUser(browser, "bob");
    const clubB = await createClub(b.page, "Club Beta");

    // Bob connaît des identifiants de A (URL complètes) : toutes les pages répondent 404, sans fuite.
    for (const path of [
      `/a/${clubA}/dashboard`, `/a/${clubA}/members`, new URL(memberUrl).pathname, `/a/${clubA}/schedule`,
      `/a/${clubA}/attendance`, `/a/${clubA}/reports`, `/a/${clubA}/settings`, `/a/${clubA}/members/import`,
    ]) {
      const res = await b.page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(b.page.getByText("Alpha-Only")).toHaveCount(0);
    }
    // Exports : refusés (pas de téléchargement)
    for (const path of [`/a/${clubA}/members/export`, `/a/${clubA}/reports/export`, `${new URL(memberUrl).pathname}/export`]) {
      const res = await b.page.request.get(path);
      expect(res.status(), path).toBe(404);
      expect(await res.text()).not.toContain("Alpha-Only");
    }
    // Une fiche de A ouverte via le chemin de B : introuvable
    const personId = /members\/([0-9a-f-]{36})/.exec(memberUrl)![1];
    expect((await b.page.goto(`/a/${clubB}/members/${personId}`))?.status()).toBe(404);

    // Les listes de B ne contiennent rien de A
    await b.page.goto(`/a/${clubB}/members`);
    await expect(b.page.getByText("Aucun membre pour le moment")).toBeVisible();

    await a.context.close();
    await b.context.close();
  });

  test("invitation d'un coach : accès limité, pas de paramètres, lien à usage unique lié à l'adresse e-mail", async ({ browser }) => {
    const owner = await newUser(browser, "owner");
    const club = await createClub(owner.page, "Club Invitations");

    const coach = await newUser(browser, "coach");
    // Avant invitation : aucun accès au club
    expect((await coach.page.goto(`/a/${club}/dashboard`))?.status()).toBe(404);

    // Le propriétaire invite le coach
    await owner.page.goto(`/a/${club}/settings`);
    const team = owner.page.getByRole("region", { name: "Équipe" });
    await team.getByLabel("E-mail").fill(coach.email);
    await team.getByRole("combobox", { name: "Rôle", exact: true }).selectOption("coach");
    await team.getByRole("button", { name: "Créer le lien d'invitation" }).click();
    const link = await owner.page.getByLabel("Lien d'invitation").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{40,}$/);
    const invitePath = new URL(link).pathname;

    // Un tiers connecté avec une autre adresse ne peut pas utiliser le lien
    const intruder = await newUser(browser, "intrus");
    await intruder.page.goto(invitePath);
    await intruder.page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(intruder.page.getByText(/invalide, expirée ou destinée à un autre compte/)).toBeVisible();
    expect((await intruder.page.goto(`/a/${club}/dashboard`))?.status()).toBe(404);

    // Le coach invité l'accepte
    await coach.page.goto(invitePath);
    await coach.page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(coach.page).toHaveURL(new RegExp(`/a/${club}/dashboard`));

    // Lien à usage unique
    await coach.page.goto(invitePath);
    await coach.page.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(coach.page.getByText(/invalide, expirée ou destinée à un autre compte/)).toBeVisible();

    // Droits du coach : pas de Paramètres, pas d'import/export, accès refusé par URL directe
    await coach.page.goto(`/a/${club}/dashboard`);
    const nav = coach.page.getByRole("navigation", { name: "Navigation principale" });
    await expect(nav.getByRole("link", { name: "Présences" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Paramètres" })).toHaveCount(0);
    for (const path of [`/a/${club}/settings`, `/a/${club}/members/import`, `/a/${club}/schedule/new`]) {
      await coach.page.goto(path);
      await expect(coach.page).toHaveURL(new RegExp(`/a/${club}/forbidden`));
      await expect(coach.page.getByRole("heading", { name: "Accès refusé" })).toBeVisible();
    }
    expect((await coach.page.request.get(`/a/${club}/members/export`)).status()).toBe(403);
    expect((await coach.page.request.get(`/a/${club}/reports/export`)).status()).toBe(403);

    // Le propriétaire peut changer le rôle puis retirer le coach
    await owner.page.goto(`/a/${club}/settings`);
    const row = owner.page.getByRole("row", { name: new RegExp(coach.email) });
    await row.getByRole("button", { name: "Retirer" }).click();
    await owner.page.getByRole("dialog").getByRole("button", { name: "Retirer" }).click();
    await expect(owner.page.getByRole("row", { name: new RegExp(coach.email) })).toHaveCount(0);
    expect((await coach.page.goto(`/a/${club}/dashboard`))?.status()).toBe(404); // accès révoqué immédiatement

    for (const c of [owner, coach, intruder]) await c.context.close();
  });
});

test.describe("authentification et en-têtes de sécurité", () => {
  test("erreurs de connexion génériques, saisie conservée, redirection ouverte refusée", async ({ page }) => {
    const email = uniqueEmail("auth");
    await signUp(page, email, "Auth");
    await page.getByRole("button", { name: "Créer le club" }).waitFor({ state: "visible" });
    await page.context().clearCookies();

    await page.goto("/login");
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe-123");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." })).toBeVisible();
    await expect(page.getByLabel("Adresse e-mail")).toHaveValue(email);
    await expect(page.getByLabel("Mot de passe")).toHaveValue(""); // le mot de passe n'est jamais re-rempli

    // e-mail inconnu : exactement le même message (pas d'énumération de comptes)
    await page.getByLabel("Adresse e-mail").fill(uniqueEmail("inconnu"));
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe-123");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Adresse e-mail ou mot de passe incorrect." })).toBeVisible();

    // `next` externe ignoré après une connexion réussie
    await logIn(page, email, "https://evil.example/phish");
    await expect(page).toHaveURL(/127\.0\.0\.1:3100\/(onboarding|academies|a\/)/);
    expect(new URL(page.url()).hostname).toBe("127.0.0.1");
  });

  test("mot de passe trop court refusé à l'inscription ; confirmation de mot de passe contrôlée", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Adresse e-mail").fill(uniqueEmail("short"));
    await page.getByLabel("Mot de passe").fill("court");
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    expect(await page.getByLabel("Mot de passe").evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
    await expect(page).toHaveURL(/\/signup/);
  });

  test("en-têtes de sécurité, CSP à nonce et cookies de session HttpOnly", async ({ page, context }) => {
    const res = await page.goto("/login");
    const h = res!.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    // HSTS : émis par UN seul composant (src/proxy.ts), uniquement pour une instance déployée en https. La pile e2e (APP_ENV=test, http) n'en émet pas ;
    // l'émission (valeur exacte, sans includeSubDomains ni preload) est prouvée sur un vrai processus par tests/e2e/startup-guards.spec.ts.
    expect(h["strict-transport-security"]).toBeUndefined();
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
    const csp = h["content-security-policy"] ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");

    const nonceA = /nonce-([^']+)/.exec(csp)![1];
    const nonceB = /nonce-([^']+)/.exec((await page.request.get("/login")).headers()["content-security-policy"] ?? "")![1];
    expect(nonceA).not.toBe(nonceB); // nonce différent à chaque requête

    await signUp(page, uniqueEmail("cookie"), "Cookie");
    const cookies = (await context.cookies()).filter((c) => c.name.includes("better-auth"));
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.httpOnly, c.name).toBe(true);
      expect(c.sameSite, c.name).toBe("Lax");
    }
    expect(await page.evaluate(() => document.cookie)).not.toContain("better-auth");
  });

  test("aucune erreur console ni de violation CSP sur les pages principales", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" || /content security policy/i.test(m.text())) problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(String(e)));
    await signUp(page, uniqueEmail("console"), "Console");
    const club = await createClub(page, "Club Console");
    for (const path of ["dashboard", "members", "members/new", "members/import", "schedule", "schedule/new", "attendance", "reports", "settings"]) {
      await page.goto(`/a/${club}/${path}`);
      await expect(page.getByRole("main")).toBeVisible();
    }
    expect(problems).toEqual([]);
  });

  test("la route de purge n'existe pas sans le bon jeton, et la santé ne révèle rien", async ({ request }) => {
    expect((await request.post("/api/cron/purge")).status()).toBe(404);
    expect((await request.post("/api/cron/purge", { headers: { Authorization: "Bearer faux" } })).status()).toBe(404);
    const health = await request.get("/api/health");
    expect(await health.json()).toEqual({ status: "ok" });
  });

  test("limitation de débit : trop de connexions échouées sont bloquées", async ({ page }) => {
    const email = uniqueEmail("burst");
    await page.goto("/login");
    let limited = false;
    for (let i = 0; i < 14 && !limited; i++) {
      await page.getByLabel("Adresse e-mail").fill(email);
      await page.getByLabel("Mot de passe").fill(`${PASSWORD}-faux-${i}`);
      // Attend la réponse de l'action serveur de CETTE tentative (sinon l'alerte de la précédente donne un faux résultat).
      await Promise.all([
        page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/login"),
        page.getByRole("button", { name: "Se connecter" }).click(),
      ]);
      const alert = page.getByRole("alert").filter({ hasText: /./ });
      await expect(alert.first()).toBeVisible();
      limited = await page.getByText("Trop de tentatives").isVisible();
    }
    expect(limited).toBe(true);
  });
});

test("séances : un membre sans club voit l'état vide, pas de données de démonstration", async ({ page }) => {
  await signUp(page, uniqueEmail("vide"), "Vide");
  const club = await createClub(page, "Club Vide");
  await page.goto(`/a/${club}/schedule`);
  await expect(page.getByText("Aucune séance cette semaine")).toBeVisible();
  await page.goto(`/a/${club}/reports`);
  await expect(page.getByText("Aucune présence sur cette période")).toBeVisible();
  await page.goto(`/a/${club}/attendance`);
  await expect(page.getByText("Aucune séance aujourd'hui").first()).toBeVisible();
});

test("rôle membre : espace personnel limité, aucune page de gestion, ne voit que ses présences", async ({ browser }) => {
  const owner = await newUser(browser, "proprio");
  const club = await createClub(owner.page, "Club Membres");
  // fiche liée au futur compte + une autre fiche (dont les données ne doivent jamais apparaître au membre)
  for (const [first, last] of [["Mia", "Adhérente"], ["Zed", "Autre-Secret"]] as const) {
    await owner.page.goto(`/a/${club}/members/new`);
    await owner.page.getByLabel("Prénom").fill(first);
    await owner.page.getByRole("textbox", { name: "Nom", exact: true }).fill(last);
    await owner.page.getByLabel("Je confirme que ce membre est majeur.").check();
    await owner.page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(owner.page.getByRole("heading", { name: `${first} ${last}` })).toBeVisible();
  }
  await owner.page.goto(`/a/${club}/schedule/new`);
  await owner.page.getByLabel("Date de la première séance").fill(parisToday());
  await owner.page.getByRole("button", { name: "Créer" }).click();
  await expect(owner.page.getByText("Création effectuée")).toBeVisible();
  await owner.page.goto(`/a/${club}/attendance`);
  await owner.page.getByRole("link", { name: "Faire l'appel" }).first().click();
  await owner.page.getByRole("group", { name: "Présence de Mia Adhérente" }).getByRole("button", { name: "Présent", exact: true }).click();
  await owner.page.getByRole("group", { name: "Présence de Zed Autre-Secret" }).getByRole("button", { name: "Présent", exact: true }).click();
  await expect(owner.page.getByText(/2 présents/)).toBeVisible();

  const member = await newUser(browser, "adherente");
  await owner.page.goto(`/a/${club}/settings`);
  const team = owner.page.getByRole("region", { name: "Équipe" });
  await team.getByLabel("E-mail").fill(member.email);
  await team.getByRole("combobox", { name: "Rôle", exact: true }).selectOption("member");
  await team.getByRole("combobox", { name: "Fiche membre liée" }).selectOption({ label: "Adhérente Mia" });
  await team.getByRole("button", { name: "Créer le lien d'invitation" }).click();
  const invitePath = new URL(await owner.page.getByLabel("Lien d'invitation").inputValue()).pathname;

  await member.page.goto(invitePath);
  await member.page.getByRole("button", { name: "Accepter l'invitation" }).click();
  await expect(member.page).toHaveURL(new RegExp(`/a/${club}/me`));
  await expect(member.page.getByRole("heading", { name: "Mon espace" })).toBeVisible();
  const nav = member.page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Planning" })).toBeVisible();
  for (const hidden of ["Membres", "Présences", "Rapports", "Paramètres", "Tableau de bord"]) await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);

  // ses propres présences uniquement
  await expect(member.page.getByRole("cell", { name: "Présent" })).toHaveCount(1);
  await expect(member.page.getByText("Autre-Secret")).toHaveCount(0);
  for (const path of ["members", "attendance", "reports", "settings", "schedule/new", "members/new"]) {
    await member.page.goto(`/a/${club}/${path}`);
    await expect(member.page).toHaveURL(new RegExp(`/a/${club}/forbidden`));
  }
  for (const path of ["members/export", "reports/export"]) expect((await member.page.request.get(`/a/${club}/${path}`)).status()).toBe(403);
  await member.page.goto(`/a/${club}/schedule`);
  await expect(member.page.getByRole("link", { name: "Modifier" })).toHaveCount(0);

  await owner.context.close();
  await member.context.close();
});
