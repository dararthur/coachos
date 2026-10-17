import { completeProfile, createClub, expect, parisToday, signUp, test, uniqueEmail } from "./support/helpers";

/**
 * Idée 7 : historique des passages et éligibilité (minimums IBJJF), réservés à l'équipe.
 * Règles de calcul : tests/unit/graduation.test.ts ; confidentialité et effacement : tests/db/rank-promotions.test.ts.
 */
test("grades : le coach enregistre un passage, voit l'éligibilité et la liste « à évaluer » ; l'adhérent n'en voit rien", async ({ page }) => {
  await signUp(page, uniqueEmail("grade"), "Admin Grade");
  const club = await createClub(page, "Club Grade");

  await test.step("un membre adulte est créé à la main", async () => {
    await page.goto(`/a/${club}/members/new`);
    await page.getByLabel("Prénom").fill("Alice");
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Gradée");
    await page.getByLabel("Type de membre").selectOption("adult");
    await page.getByLabel("Je confirme que ce membre est majeur.").check();
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByRole("heading", { name: "Alice Gradée" })).toBeVisible();
    await expect(page.getByText("Aucun passage enregistré.")).toBeVisible();
  });

  await test.step("passage à la ceinture bleue il y a plus de deux ans : éligible à la violette", async () => {
    await page.getByLabel("Grade obtenu").selectOption("blue");
    await page.getByLabel("Date d'obtention").fill(parisToday(-800));
    await page.getByRole("button", { name: "Enregistrer le grade" }).click();
    await expect(page.getByText("Passage enregistré.")).toBeVisible();
    await expect(page.getByText(/Éligible à la ceinture violette depuis le/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Historique des passages de ceinture" })).toBeVisible();
  });

  await test.step("une date future est refusée ; un passage à la violette hier n'ouvre l'éligibilité à la marron que dans dix-huit mois", async () => {
    await page.getByLabel("Grade obtenu").selectOption("purple");
    await page.getByLabel("Date d'obtention").evaluate((el: HTMLInputElement) => el.removeAttribute("max"));
    await page.getByLabel("Date d'obtention").fill(parisToday(3));
    await page.getByRole("button", { name: "Enregistrer le grade" }).click();
    await expect(page.getByText(/Passage invalide/)).toBeVisible();

    await page.getByLabel("Date d'obtention").fill(parisToday(-1));
    await page.getByRole("button", { name: "Enregistrer le grade" }).click();
    await expect(page.getByText("Passage enregistré.")).toBeVisible();
    await expect(page.getByText(/Éligible à la ceinture marron à partir du/)).toBeVisible();
  });

  const history = () => page.getByRole("list", { name: "Historique des passages de ceinture" });
  const current = () => history().getByRole("listitem").filter({ has: page.getByText("Actuel", { exact: true }) });

  await test.step("un ancien grade complète l'historique sans changer le grade actuel ; daté après lui, il est refusé", async () => {
    await page.getByRole("radio", { name: /Ancien grade/ }).check();
    await page.getByLabel("Grade obtenu").selectOption("white");
    await page.getByLabel("Date d'obtention").fill(parisToday(-1800));
    await page.getByRole("button", { name: "Enregistrer le grade" }).click();
    await expect(page.getByText("Ancien grade ajouté à l'historique : le grade actuel ne change pas.")).toBeVisible();
    await expect(history().getByRole("listitem")).toHaveCount(3);
    await expect(current()).toContainText("violette");

    await page.getByRole("radio", { name: /Ancien grade/ }).check();
    await page.getByLabel("Date d'obtention").fill(parisToday());
    await page.getByRole("button", { name: "Enregistrer le grade" }).click();
    await expect(page.getByText(/Un ancien grade doit être daté avant le grade actuel/)).toBeVisible();
  });

  await test.step("une ligne se corrige ; supprimer le grade actuel ramène la fiche au grade précédent", async () => {
    const white = history().getByRole("listitem").filter({ hasText: "Corriger le grade blanche" });
    await white.locator("summary").click();
    await white.getByLabel("Barrettes").selectOption("2");
    await white.getByRole("button", { name: "Enregistrer la correction" }).click();
    await expect(page.getByText("Grade corrigé.")).toBeVisible();
    await expect(history().getByRole("listitem").filter({ hasText: "Corriger le grade blanche, 2 barrettes" })).toHaveCount(1);

    await current().getByRole("button", { name: /Supprimer le grade violette/ }).click();
    await expect(page.getByRole("dialog")).toContainText("la fiche reviendra au grade précédent (bleue)");
    await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
    await expect(history().getByRole("listitem")).toHaveCount(2);
    await expect(current()).toContainText("bleue");
    await expect(page.getByText(/Éligible à la ceinture violette depuis le/)).toBeVisible();

    // On remet la violette d'hier pour la suite du parcours.
    await page.getByLabel("Grade obtenu").selectOption("purple");
    await page.getByLabel("Date d'obtention").fill(parisToday(-1));
    await page.getByRole("button", { name: "Enregistrer le grade" }).click();
    await expect(page.getByText("Passage enregistré.")).toBeVisible();
  });

  await test.step("la date de la ceinture actuelle se corrige ; le tableau de bord liste alors Alice (équipe seulement)", async () => {
    await page.getByLabel("Reçue le").fill(parisToday(-600));
    await page.getByRole("button", { name: "Confirmer la date" }).click();
    await expect(page.getByText("Date enregistrée.")).toBeVisible();
    await expect(page.getByText(/Éligible à la ceinture marron depuis le/)).toBeVisible();

    await page.goto(`/a/${club}/dashboard`);
    await expect(page.getByRole("heading", { name: "Passages à évaluer" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Alice Gradée/ })).toBeVisible();
    // Export CSV « Éligibles au grade suivant » : mêmes personnes que la liste, en entier, avec les dates calculées.
    const csv = await page.request.get(`/a/${club}/members/eligible-export`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(csv.headers()["content-disposition"]).toContain("eligibles-grade-suivant-");
    const body = await csv.text();
    expect(body).toContain('"Ceinture suivante"');
    expect(body).toContain('"Alice"');
    expect(body).toContain('"Éligible"');
    expect(body).toContain('"marron"');
    await page.goto(`/a/${club}/members`);
    await page.getByRole("link", { name: /GRADÉE Alice/ }).click();
  });

  await test.step("l'adhérent ne voit ni historique, ni éligibilité, ni liste", async () => {
    await page.getByRole("button", { name: "Mode membre" }).click();
    await completeProfile(page, club);
    await page.goto(`/a/${club}/profile`);
    await expect(page.getByRole("heading", { name: "Faire une pause" })).toBeVisible();
    await expect(page.getByText(/Grade et passages|Éligible|minimums IBJJF|Passages à évaluer/)).toHaveCount(0);
    // « Mon compte » mène au profil de membre du club.
    await page.goto("/account");
    await page.getByRole("link", { name: /Modifier mon profil/ }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${club}/profile`));
    await expect(page.getByRole("heading", { name: "Mon profil" })).toBeVisible();
    await page.goto(`/a/${club}/me`);
    await expect(page.getByText(/Éligible|minimums IBJJF|Passages à évaluer/)).toHaveCount(0);
  });
});
