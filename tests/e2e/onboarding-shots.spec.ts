import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { createClub, expect, PASSWORD, parisToday, randomIp, signUp, test, uniqueEmail, waitForMail } from "./support/helpers";

/**
 * Captures d'écran du guide de démarrage (docs/onboarding/guide-demarrage-matnexa.pdf). Ce n'est PAS un test de non-régression :
 * il ne tourne que si ONBOARDING_SHOTS_DIR est défini, sur un club 100 % fictif créé pour l'occasion.
 *
 * La plupart des adhérents, des coachs et des administrateurs utilisent Matnexa sur téléphone : le parcours est capturé sur un
 * téléphone (préfixes p- pour l'équipe, m- pour les adhérents) ; seules quelques vues propres à l'ordinateur (import d'un fichier,
 * tableau de bord, liste) le sont en grand écran (préfixe d-).
 *
 *   ONBOARDING_SHOTS_DIR=docs/onboarding/img PW_CHANNEL=msedge E2E_PORT=3150 npx playwright test --project=chromium onboarding-shots
 */
const OUT = process.env.ONBOARDING_SHOTS_DIR;
test.skip(!OUT, "captures du guide de démarrage : définir ONBOARDING_SHOTS_DIR");

const MEMBERS = [
  ["Camille", "Durand", "2024-09-02"], ["Lucas", "Martin", "2024-09-09"], ["Inès", "Bernard", "2025-01-13"], ["Hugo", "Petit", "2025-01-13"],
  ["Léa", "Robert", "2025-02-03"], ["Nathan", "Richard", "2025-03-10"], ["Manon", "Moreau", "2025-03-10"], ["Théo", "Simon", "2025-09-01"],
  ["Chloé", "Laurent", "2025-09-01"], ["Maxime", "Lefebvre", "2025-09-15"], ["Sarah", "Roux", "2026-01-12"], ["Antoine", "Fournier", "2026-01-12"],
];

/** Les adresses de test (@example.invalid) et l'adresse locale du lien de partage n'ont rien à faire dans un document destiné aux clubs. */
async function shot(page: Page | Locator, name: string) {
  mkdirSync(OUT!, { recursive: true });
  if ("goto" in page) {
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
      for (const el of document.querySelectorAll("*")) if (el.children.length === 0 && /@example\.invalid/.test(el.textContent ?? "")) el.textContent = "claire.dubois@academie-horizon.fr";
    });
    await page.waitForTimeout(700); // fin des transitions (boutons de l'appel, focus)
  } else
    // Capture d'un bloc : la barre d'onglets et l'en-tête collants du téléphone ne doivent pas le recouvrir.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("body *")) if (["fixed", "sticky"].includes(getComputedStyle(el).position)) el.style.visibility = "hidden";
    });
  await page.screenshot({ path: path.join(OUT!, `${name}.jpg`), type: "jpeg", quality: 90 });
}

const phone = () => ({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "fr-FR",
  extraHTTPHeaders: { "x-real-ip": randomIp() },
});

test("captures du guide de démarrage", async ({ browser }) => {
  test.setTimeout(300_000);

  // --- Équipe, sur téléphone ----------------------------------------------------------------------------------------------------
  const ctx = await browser.newContext(phone());
  const page = await ctx.newPage();
  const email = uniqueEmail("coach-guide");
  await signUp(page, email, "Claire Dubois");
  await page.locator("input[name=name]").evaluate((el) => ((el as HTMLInputElement).value = "Académie Horizon"));
  await shot(page, "p-onboarding");
  const club = await createClub(page, "Académie Horizon");
  await expect(page.getByText("Bienvenue !")).toBeVisible();
  await shot(page, "p-firststeps");

  // Paramètres : identité du club, code d'inscription, équipe
  await page.goto(`/a/${club}/settings`);
  await shot(page, "p-settings");
  await page.goto(`/a/${club}/settings#inscription`);
  const join = page.locator("#inscription");
  await expect(join).toBeVisible();
  await page.locator("#join-link").evaluate((el) => {
    (el as HTMLInputElement).value = (el as HTMLInputElement).value.replace(new RegExp("^https?://[^/]+"), "https://app.matnexa.fr");
  });
  await shot(join, "p-join-code");
  const code = (await page.getByTestId("join-code").innerText()).replace("-", "");
  await shot(page.locator("#equipe"), "p-team");

  // Adhérents : import CSV, puis liste
  const csv = path.join(os.tmpdir(), "adherents-exemple.csv");
  writeFileSync(csv, ["prénom;nom;email;date_inscription", ...MEMBERS.map(([f, l, d]) => `${f};${l};;${d}`)].join("\n"), "utf8");
  await page.goto(`/a/${club}/members/import`);
  await page.getByLabel("Fichier CSV").setInputFiles(csv);
  await page.getByRole("button", { name: "Analyser le fichier" }).click();
  await expect(page.getByRole("button", { name: /Importer 12 membres/ })).toBeVisible();
  await page.getByLabel(/Je certifie que les membres sans date/).check();
  await page.getByRole("button", { name: /Importer 12 membres/ }).click();
  await expect(page.getByText("12 membres importés.")).toBeVisible();
  await page.goto(`/a/${club}/members`);
  await shot(page, "p-members");

  // Planning : formulaire, puis séances
  await page.goto(`/a/${club}/schedule/new`);
  await page.getByLabel("Date de la première séance").fill(parisToday());
  await page.getByLabel("Heure de début").fill("18:30");
  await page.getByLabel("Nombre de places").fill("25");
  await page.getByLabel("Fréquence").selectOption("weekly");
  for (const day of ["Lundi", "Mercredi", "Vendredi"]) await page.getByLabel(day, { exact: true }).check();
  await page.getByLabel("Répéter jusqu'au").fill(parisToday(28));
  await shot(page, "p-schedule-new");
  await page.getByRole("button", { name: "Créer la séance" }).click();
  await expect(page.getByText(/Création effectuée/)).toBeVisible();
  await page.goto(`/a/${club}/schedule`);
  await shot(page, "p-schedule");

  // Appel
  await page.goto(`/a/${club}/attendance`);
  const roll = page.getByRole("link", { name: "Faire l'appel" }).first();
  if (await roll.count()) {
    await roll.click();
    for (const name of ["Camille Durand", "Lucas Martin", "Inès Bernard", "Hugo Petit", "Léa Robert"])
      await page.getByRole("group", { name: `Présence de ${name}` }).getByRole("button", { name: "Présent", exact: true }).click();
    await page.getByRole("group", { name: "Présence de Nathan Richard" }).getByRole("button", { name: "En retard" }).click();
    await shot(page, "p-attendance");
  }

  // Pointage par QR : réglage, affiche à imprimer
  await page.goto(`/a/${club}/settings#pointage`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Mode de pointage").selectOption("fixed");
  await page.getByRole("button", { name: "Enregistrer" }).last().click();
  await expect(page.getByText("Réglages du pointage enregistrés.")).toBeVisible();
  await shot(page.locator("#pointage"), "p-pointage");
  await page.goto(`/a/${club}/settings/qr`);
  await page.locator("#qr-link").evaluate((el) => ((el as HTMLInputElement).value = "https://app.matnexa.fr/checkin/club/…"));
  await shot(page, "p-qr");

  await page.goto(`/a/${club}/dashboard`);
  await shot(page, "p-dashboard");

  // --- Quelques vues d'ordinateur, avec la même session -------------------------------------------------------------------------------
  const desk = await browser.newContext({
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, locale: "fr-FR", storageState: await ctx.storageState(), extraHTTPHeaders: { "x-real-ip": randomIp() },
  });
  const d = await desk.newPage();
  await d.goto(`/a/${club}/dashboard`);
  await expect(d.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await shot(d, "d-dashboard");
  await d.goto(`/a/${club}/members`);
  await shot(d, "d-members");
  // Aperçu d'un second fichier (autres prénoms) : on ne l'importe pas, on montre l'étape de vérification.
  const csv2 = path.join(os.tmpdir(), "adherents-exemple-2.csv");
  writeFileSync(csv2, ["prénom;nom;email;date_inscription", "Jade;Garnier;;2026-09-07", "Louis;Faure;;2026-09-07", "Emma;Blanc;;2026-09-14", "Adam;Guerin;;2026-09-14", "Zoé;Muller;;2026-09-21", "Paul;Henry;;2026-09-21"].join("\n"), "utf8");
  await d.goto(`/a/${club}/members/import`);
  await d.getByLabel("Fichier CSV").setInputFiles(csv2);
  await d.getByRole("button", { name: "Analyser le fichier" }).click();
  await expect(d.getByRole("button", { name: /Importer 6 membres/ })).toBeVisible();
  await shot(d, "d-import");

  // --- Adhérent, sur téléphone ------------------------------------------------------------------------------------------------------
  const mobile = await browser.newContext(phone());
  const m = await mobile.newPage();
  await m.goto(`/join/${code}`);
  await shot(m, "m-join");
  await m.getByRole("link", { name: "Créer mon compte" }).click();
  const memberMail = uniqueEmail("adherent-guide");
  await m.getByLabel("Prénom et nom").fill("Julie Girard");
  await m.getByLabel("Adresse e-mail").fill(memberMail);
  await m.getByLabel("Mot de passe").fill(PASSWORD);
  await m.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(m.getByText("Compte créé", { exact: false })).toBeVisible();
  await m.goto((await waitForMail(memberMail, "verification")).link);
  await m.getByLabel("Adresse e-mail").fill(memberMail);
  await m.getByLabel("Mot de passe").fill(PASSWORD);
  await m.getByRole("button", { name: "Se connecter" }).click();
  await expect(m).toHaveURL(new RegExp(`/join/${code}`));
  await m.getByRole("button", { name: "Rejoindre Académie Horizon" }).click();
  await expect(m).toHaveURL(new RegExp(`/a/${club}/profile`));
  await shot(m, "m-profile");
  const adult = m.getByLabel("Je confirme avoir 18 ans ou plus.");
  if (await adult.count()) await adult.check();
  await m.getByRole("button", { name: "Valider mon profil" }).click();
  await expect(m.getByText("Profil enregistré.")).toBeVisible();
  await m.goto(`/a/${club}/me`);
  await shot(m, "m-me");
  await m.goto(`/a/${club}/schedule`);
  await shot(m, "m-schedule");
  await m.goto("/checkin?scan=1");
  await shot(m, "m-scan");
  await m.goto("/account");
  await shot(m, "m-account");
});
