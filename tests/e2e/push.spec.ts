import { createClub, expect, signUp, test, uniqueEmail } from "./support/helpers";

// L'abonnement réel dépend du service de notification du navigateur (réseau) : il se vérifie sur appareil. Ici : l'interface,
// la politique de sécurité et le refus des abonnements non conformes.

// Précondition du navigateur de TEST (pas de l'application) : un vrai Chrome sans réglage présente la permission « default ».
// chrome-headless-shell (ancien mode headless, défaut de Playwright) annonce « denied » : l'application affiche alors, à juste
// titre, « notifications bloquées » au lieu du bouton. playwright.config.ts utilise donc le vrai Chromium (channel "chromium").
test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  expect(await page.evaluate(() => Notification.permission), "navigateur de test : permission de notification attendue « default » (chrome-headless-shell ?)").toBe("default");
});

test("notifications : bloc sur « Mon compte », case sur la publication", async ({ page }) => {
  await signUp(page, uniqueEmail("push"), "Push Test");
  const club = await createClub(page, "Club Push");

  await page.goto("/account");
  const card = page.getByRole("heading", { name: "Notifications" });
  await expect(card).toBeVisible();
  await expect(page.getByRole("button", { name: "Activer les notifications" })).toBeVisible();
  // Rien n'est demandé au navigateur ni enregistré avant le clic.
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);

  // La politique de sécurité autorise le service worker de l'application, et lui seul.
  const res = await page.request.get("/account");
  expect(res.headers()["content-security-policy"]).toContain("worker-src 'self'");

  // Publication : la case « Prévenir les membres » est cochée par défaut ; la publication aboutit même sans abonné.
  await page.goto(`/a/${club}/news/new`);
  const notify = page.getByLabel("Prévenir les membres par notification");
  await expect(notify).toBeChecked();
  await page.getByLabel("Titre").fill("Stage de samedi");
  await page.getByLabel("Texte").fill("Rendez-vous à 10 h.");
  await page.getByRole("button", { name: "Publier" }).click();
  await expect(page.getByText("Publication en ligne")).toBeVisible();

  // L'édition n'envoie rien de nouveau : pas de case.
  await page.getByRole("link", { name: /Modifier/ }).click();
  await expect(page.getByLabel("Prévenir les membres par notification")).toHaveCount(0);
});

test("proposition d'activer les notifications : seulement dans l'application installée, une fois, refermable", async ({ page }) => {
  await signUp(page, uniqueEmail("pushprompt"), "Push Prompt");
  const club = await createClub(page, "Club Prompt");
  const prompt = page.getByRole("complementary", { name: "Activer les notifications" });

  // Onglet de navigateur : rien n'est proposé.
  await page.goto(`/a/${club}/dashboard`);
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await expect(prompt).toHaveCount(0);

  // Application installée (mode d'affichage « standalone ») : la proposition apparaît.
  await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => (query.includes("display-mode: standalone") ? ({ ...original(query), matches: true } as MediaQueryList) : original(query));
  });
  await page.goto(`/a/${club}/dashboard`);
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("button", { name: "Activer les notifications" })).toBeVisible();

  // « Plus tard » : refermée, et ne revient pas au rechargement.
  await prompt.getByRole("button", { name: "Plus tard" }).click();
  await expect(prompt).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await expect(prompt).toHaveCount(0);
});
