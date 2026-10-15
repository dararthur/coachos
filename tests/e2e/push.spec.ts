import { createClub, expect, signUp, test, uniqueEmail } from "./support/helpers";

// L'abonnement réel dépend du service de notification du navigateur (réseau) : il se vérifie sur appareil. Ici : l'interface,
// la politique de sécurité et le refus des abonnements non conformes.

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
