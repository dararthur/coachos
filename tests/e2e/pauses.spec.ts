import { completeProfile, createClub, expect, parisToday, signUp, test, uniqueEmail } from "./support/helpers";

/**
 * P1.5 : pause déclarée (staff et adhérent) avec consentement pour blessure et maladie, vignettes réservées à l'équipe, motif de départ.
 * Règles de fond (visibilité, effacement, mineurs) : tests/db/member-lifecycle.test.ts.
 */
test("pauses : consentement exigé pour une blessure, « ne souhaite pas s'exprimer » sans motif, vignette en liste, pause de l'adhérent, motif de départ", async ({ page }) => {
  await signUp(page, uniqueEmail("pause"), "Admin Pause");
  const club = await createClub(page, "Club Pause");

  await test.step("un membre est créé à la main", async () => {
    await page.goto(`/a/${club}/members/new`);
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Pausée");
    await page.getByLabel("Type de membre").selectOption("adult");
    await page.getByLabel("Je confirme que ce membre est majeur.").check();
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByRole("heading", { name: "Alice Pausée" })).toBeVisible();
  });

  await test.step("blessure : refusée sans le consentement, acceptée avec ; la vignette apparaît sur la fiche et dans la liste", async () => {
    const card = page.locator("section, div").filter({ has: page.getByRole("heading", { name: "Pause", exact: true }) }).last();
    await page.getByLabel("Raison").selectOption("injury");
    await page.getByLabel("Reprise prévue le").fill(parisToday(10));
    await page.getByRole("button", { name: "Enregistrer la pause" }).click();
    await expect(page.getByText("Le consentement explicite de la personne est requis")).toBeVisible();
    await expect(page.getByText(/Blessure jusqu'au/)).toHaveCount(0);

    await page.getByLabel(/La personne m'a informé/).check();
    await page.getByRole("button", { name: "Enregistrer la pause" }).click();
    await expect(page.getByText("Pause enregistrée.")).toBeVisible();
    await expect(page.getByText(/Blessure jusqu'au/).first()).toBeVisible();
    expect(card).toBeTruthy();

    await page.goto(`/a/${club}/members`);
    await expect(page.getByText(/Blessure jusqu'au/).first()).toBeAttached(); // lisible par un lecteur d'écran, vignette 🩹 à l'écran
  });

  await test.step("« Ne souhaite pas s'exprimer » : aucune raison ni consentement de santé n'est demandé ; la pause se lève", async () => {
    await page.getByRole("link", { name: /PAUSÉE Alice/ }).click();
    await page.getByLabel("Raison").selectOption("undisclosed");
    await page.getByLabel("Reprise prévue le").fill(parisToday(5));
    await page.getByRole("button", { name: "Mettre à jour la pause" }).click();
    await expect(page.getByText("Pause enregistrée.")).toBeVisible();
    await expect(page.getByText(/Ne souhaite pas s'exprimer jusqu'au/).first()).toBeVisible();
    await page.getByRole("button", { name: "Lever la pause" }).click();
    // Le formulaire de levée disparaît avec la pause : la vignette qui s'efface est la confirmation.
    await expect(page.getByText(/jusqu'au/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lever la pause" })).toHaveCount(0);
  });

  await test.step("archivage avec un motif de départ (liste sans catégorie de santé)", async () => {
    await page.getByRole("button", { name: "Archiver" }).click();
    const dialog = page.getByRole("dialog");
    const options = await dialog.getByLabel("Motif du départ (facultatif)").locator("option").allTextContents();
    expect(options.join("|")).toMatch(/Prix/);
    expect(options.join("|")).toMatch(/Ne souhaite pas s'exprimer/);
    expect(options.join("|")).not.toMatch(/Blessure|Malade|santé/i);
    await dialog.getByLabel("Motif du départ (facultatif)").selectOption("price");
    await dialog.getByRole("button", { name: "Archiver" }).click();
    await expect(page.getByText("Archivé", { exact: true })).toBeVisible();
  });

  await test.step("l'adhérent déclare sa propre pause depuis « Mon profil » (même règle de consentement)", async () => {
    await page.getByRole("button", { name: "Mode membre" }).click();
    await completeProfile(page, club);
    await page.goto(`/a/${club}/profile`);
    await expect(page.getByRole("heading", { name: "Faire une pause" })).toBeVisible();
    await page.getByLabel("Raison").selectOption("sick");
    await page.getByLabel("Reprise prévue le").fill(parisToday(7));
    await page.getByRole("button", { name: "Enregistrer la pause" }).click();
    await expect(page.getByText("Le consentement explicite de la personne est requis")).toBeVisible();

    await page.getByLabel("Raison").selectOption("undisclosed");
    await page.getByRole("button", { name: "Enregistrer la pause" }).click();
    await expect(page.getByText(/Pause enregistrée/)).toBeVisible();
    await expect(page.getByText(/Ne souhaite pas s'exprimer jusqu'au/).first()).toBeVisible();
    await page.getByRole("button", { name: "Reprendre maintenant" }).click();
    await expect(page.getByText(/jusqu'au/)).toHaveCount(0);
  });
});
