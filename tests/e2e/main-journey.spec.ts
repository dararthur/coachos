import { readFileSync } from "node:fs";
import path from "node:path";
import { createClub, logIn, parisToday, signUp, uniqueEmail, expect, test } from "./support/helpers";

/**
 * Parcours principal bout en bout, contre PostgreSQL réel (RLS active) et un faux GoTrue.
 * Inscription -> club -> cours -> membres (formulaire + import CSV) -> séances -> appel -> tableau de bord
 * -> historique + export -> reconnexion -> effacement RGPD.
 */
test("parcours complet : de l'inscription à l'export des présences", async ({ page }) => {
  const email = uniqueEmail("owner");
  let academyId = "";

  await test.step("accès protégé : redirection vers la connexion", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/academies");
    await expect(page).toHaveURL(/\/login/);
  });

  await test.step("inscription puis création du club", async () => {
    await signUp(page, email, "Alex Propriétaire");
    academyId = await createClub(page, "Dojo de test");
    await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
    await expect(page.getByText("Bienvenue !")).toBeVisible(); // état vide, pas de chiffres inventés
    await expect(page.getByText("Membres actifs", { exact: true })).toBeVisible();
  });

  await test.step("paramètres : un type de cours est créé", async () => {
    await page.getByRole("link", { name: "Paramètres" }).click();
    const types = page.getByRole("region", { name: "Types de cours" });
    await types.getByLabel("Nom du cours").fill("JJB Fondamentaux");
    await types.getByRole("button", { name: "Ajouter" }).click();
    await expect(types.getByText("Type de cours ajouté.")).toBeVisible();
    await expect(types.getByRole("rowheader", { name: "JJB Fondamentaux" })).toBeVisible();
  });

  await test.step("membre créé à la main (attestation de majorité obligatoire)", async () => {
    await page.goto(`/a/${academyId}/members/new`);
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Manuelle");
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByText("Je confirme que ce membre est majeur.")).toBeVisible();
    // validation native du navigateur : le formulaire n'est pas soumis tant que majeur/mineur n'est pas choisi
    expect(await page.getByLabel("Type de membre").evaluate((el) => (el as HTMLSelectElement).validity.valid)).toBe(false);
    await expect(page).toHaveURL(/members\/new/);
    await expect(page.getByLabel("Prénom")).toHaveValue("Alice");
    await page.getByLabel("Type de membre").selectOption("adult");
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByText("Vous devez attester que ce membre est majeur.")).toBeVisible();
    await page.getByLabel("Je confirme que ce membre est majeur.").check();
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByRole("heading", { name: "Alice Manuelle" })).toBeVisible();
  });

  await test.step("import CSV : aperçu, rejets explicites, puis import", async () => {
    await page.goto(`/a/${academyId}/members/import`);
    await page.getByLabel("Fichier CSV").setInputFiles(path.join(import.meta.dirname, "..", "fixtures", "members.csv"));
    await page.getByRole("button", { name: "Analyser le fichier" }).click();
    await expect(page.getByText("Lignes invalides (non importées)")).toBeVisible();
    await expect(page.getByText(/Ligne 6 : .*commencer par/)).toBeVisible(); // injection de formule
    await expect(page.getByText(/Ligne 7 : .*Date d'inscription invalide/)).toBeVisible(); // 31/02
    await expect(page.getByText("Doublons dans le fichier (ignorés)")).toBeVisible();
    await expect(page.getByText("téléphone", { exact: true })).toBeVisible(); // colonne ignorée signalée
    const importButton = page.getByRole("button", { name: "Importer 3 membres" });
    await expect(importButton).toBeDisabled(); // attestation requise
    await page.getByLabel(/Je certifie que les membres sans date/).check();
    await importButton.click();
    await expect(page.getByText("3 membres importés.")).toBeVisible();

    await page.goto(`/a/${academyId}/members`);
    await expect(page.getByRole("link", { name: /FIXTURE-UN Camille/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /MANUELLE Alice/ })).toBeVisible();
  });

  await test.step("import idempotent : un second import ne crée rien", async () => {
    await page.goto(`/a/${academyId}/members/import`);
    await page.getByLabel("Fichier CSV").setInputFiles(path.join(import.meta.dirname, "..", "fixtures", "members.csv"));
    await page.getByRole("button", { name: "Analyser le fichier" }).click();
    await expect(page.getByText("Aucun membre à créer dans ce fichier.")).toBeVisible();
  });

  await test.step("planning : séance du jour puis récurrence hebdomadaire", async () => {
    await page.goto(`/a/${academyId}/schedule/new`);
    await page.getByLabel("Date de la première séance").fill(parisToday());
    await page.getByLabel("Heure de début").fill("12:00");
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page).toHaveURL(/schedule\?created=1/);
    await expect(page.getByText("Création effectuée : 1 séance")).toBeVisible();

    await page.goto(`/a/${academyId}/schedule/new`);
    await page.getByLabel("Date de la première séance").fill(parisToday(1));
    await page.getByLabel("Heure de début").fill("19:00");
    await page.getByLabel("Fréquence").selectOption("weekly");
    for (const day of ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]) await page.getByLabel(day, { exact: true }).check();
    await page.getByLabel("Répéter jusqu'au").fill(parisToday(7));
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Création effectuée : 7 séances")).toBeVisible();

    // créer deux fois le même créneau n'est pas un faux succès
    await page.goto(`/a/${academyId}/schedule/new`);
    await page.getByLabel("Date de la première séance").fill(parisToday());
    await page.getByLabel("Heure de début").fill("12:00");
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Ces séances existent déjà : rien n'a été créé.")).toBeVisible();
  });

  await test.step("appel : présences enregistrées, modifiées et persistantes", async () => {
    await page.goto(`/a/${academyId}/attendance`);
    await page.getByRole("link", { name: "Faire l'appel" }).first().click();
    const row = (name: string) => page.getByRole("group", { name: `Présence de ${name}` });
    await row("Camille Fixture-Un").getByRole("button", { name: "Présent", exact: true }).click();
    await expect(row("Camille Fixture-Un").getByRole("button", { name: "Présent", exact: true })).toHaveAttribute("aria-pressed", "true");
    await row("Dominique Fixture-Deux").getByRole("button", { name: "En retard" }).click();
    await row("Eden Fixture-Trois").getByRole("button", { name: "Absent" }).click();
    await row("Alice Manuelle").getByRole("button", { name: "Présent", exact: true }).click();
    await expect(page.getByText(/2 présents/)).toBeVisible();
    // modification : Alice passe en retard
    await row("Alice Manuelle").getByRole("button", { name: "En retard" }).click();
    await expect(row("Alice Manuelle").getByRole("button", { name: "En retard" })).toHaveAttribute("aria-pressed", "true");

    await page.reload(); // persistance réelle en base
    await expect(row("Camille Fixture-Un").getByRole("button", { name: "Présent", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(row("Alice Manuelle").getByRole("button", { name: "En retard" })).toHaveAttribute("aria-pressed", "true");
    await expect(row("Eden Fixture-Trois").getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("tableau de bord : indicateurs issus de la base", async () => {
    await page.goto(`/a/${academyId}/dashboard`);
    const stat = (label: string) => page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");
    await expect(stat("Membres actifs")).toHaveText(/^4/);
    await expect(stat("Séances aujourd'hui")).toHaveText(/^1/);
    await expect(stat("Présences cette semaine")).toHaveText(/^3/); // 2 présents/retards import + Alice en retard
    await expect(page.getByText("Appel fait")).toBeVisible();
  });

  await test.step("historique des présences et export CSV", async () => {
    await page.goto(`/a/${academyId}/reports`);
    await expect(page.getByRole("cell", { name: "Présent", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: /FIXTURE-UN Camille/ })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Exporter (CSV)" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^presences-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync(await download.path(), "utf8");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Camille";"Fixture-Un";"Présent"');
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(5); // en-tête + 4 présences
  });

  await test.step("déconnexion puis reconnexion : les données persistent", async () => {
    await page.getByRole("button", { name: "Déconnexion" }).first().click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`/a/${academyId}/members`);
    await expect(page).toHaveURL(/\/login/); // session détruite
    await logIn(page, email);
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto(`/a/${academyId}/members`);
    await expect(page.getByRole("link", { name: /FIXTURE-DEUX Dominique/ })).toBeVisible();
  });

  await test.step("RGPD : export des données d'un membre puis anonymisation", async () => {
    await page.goto(`/a/${academyId}/members`);
    await page.getByRole("link", { name: /FIXTURE-TROIS Eden/ }).click();
    const dl = page.waitForEvent("download");
    await page.getByRole("link", { name: "Exporter ses données" }).click();
    const json = JSON.parse(readFileSync(await (await dl).path(), "utf8"));
    expect(json.person.first_name).toBe("Eden");
    expect(json.attendance).toHaveLength(1);

    await page.getByRole("button", { name: "Anonymiser ou supprimer…" }).click();
    const dialog = page.getByRole("dialog", { name: "Effacer les données de ce membre" });
    await dialog.getByRole("button", { name: "Effacer définitivement" }).click();
    // pas d'effacement sans confirmation : la validation native bloque l'envoi
    expect(await dialog.getByLabel("Je confirme vouloir effacer ces données de façon irréversible.").evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Je confirme vouloir effacer ces données de façon irréversible.").check();
    await dialog.getByRole("button", { name: "Effacer définitivement" }).click();
    await expect(page.getByText(/Membre anonymisé : ses présences sont conservées/)).toBeVisible();
    await expect(page.getByText("Eden")).toHaveCount(0);

    await page.goto(`/a/${academyId}/reports`);
    await expect(page.getByText("Membre anonymisé").first()).toBeVisible();
  });
});
