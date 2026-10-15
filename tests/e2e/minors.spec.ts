import { createClub, expect, mailsTo, signUp, test, uniqueEmail, waitForMail } from "./support/helpers";

test("mineur : fiche avec responsable légal, accord par lien, ceinture enfant, retrait de l'accord", async ({ page, browser }) => {
  await signUp(page, uniqueEmail("minors"), "Coach Mineurs");
  const club = await createClub(page, "Club Mineurs");
  const parentEmail = uniqueEmail("parent");

  await test.step("un mineur exige date de naissance et responsable", async () => {
    await page.goto(`/a/${club}/members/new`);
    await page.getByLabel("Prénom").fill("Léo");
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Petit");
    await page.getByLabel("Type de membre").selectOption("minor");
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByText("Date de naissance requise pour un mineur.")).toBeVisible();
    await expect(page.getByText("Nom du responsable légal requis.")).toBeVisible();
    await page.getByLabel("Date de naissance").fill("1990-01-01");
    await page.getByLabel("Nom du responsable légal").fill("Sophie Petit");
    await page.getByLabel("E-mail du responsable légal").fill(parentEmail);
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByText("Cette personne a 18 ans ou plus")).toBeVisible();
    const year = new Date().getFullYear() - 10;
    await page.getByLabel("Date de naissance").fill(`${year}-03-04`);
    await page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(page.getByRole("heading", { name: "Léo Petit" })).toBeVisible();
    await expect(page.getByText("Un lien d'accord a été envoyé au responsable légal.")).toBeVisible();
    await expect(page.getByText("Accord en attente")).toBeVisible();
    // Pas de contact direct avec l'enfant tant que l'accord n'est pas confirmé.
    await expect(page.getByRole("link", { name: /WhatsApp|Écrire/ })).toHaveCount(0);
  });

  await test.step("le responsable confirme depuis le lien (sans compte) ; l'ouverture seule ne confirme rien", async () => {
    const mail = await waitForMail(parentEmail, "guardian_consent");
    const ctx = await browser.newContext();
    const parent = await ctx.newPage();
    await parent.goto(mail.link);
    await expect(parent.getByText("Aucune donnée de santé n'est collectée.")).toBeVisible();
    await parent.goto(mail.link);
    await expect(parent.getByRole("button", { name: "Je confirme mon accord" })).toBeVisible();
    await parent.getByRole("button", { name: "Je confirme mon accord" }).click();
    await expect(parent.getByText("Merci : votre accord est enregistré.")).toBeVisible();
    await ctx.close();
    expect(mailsTo(parentEmail, "guardian_consent")).toHaveLength(1);
  });

  await test.step("accord confirmé : contact via le responsable, ceinture enfant IBJJF", async () => {
    await page.reload();
    await expect(page.getByText(/Accord confirmé le/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Écrire au responsable" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Ceinture").selectOption("orange_white");
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(page.getByText("Fiche mise à jour.")).toBeVisible();
    await page.goto(`/a/${club}/members`);
    await expect(page.getByRole("img", { name: "Ceinture orange et blanche" }).first()).toBeVisible();
  });

  await test.step("l'administrateur retire l'accord : la fiche est archivée", async () => {
    await page.getByRole("link", { name: /petit/i }).first().click();
    await page.getByRole("button", { name: "Retirer l'accord…" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retirer l'accord" }).click();
    await expect(page.getByText("Accord retiré")).toBeVisible();
    await expect(page.getByText("Archivé")).toBeVisible();
  });
});

test("l'import CSV crée un mineur avec lien d'accord envoyé au responsable", async ({ page }) => {
  await signUp(page, uniqueEmail("minors-csv"), "Coach Import");
  const club = await createClub(page, "Club Import Mineurs");
  const parentEmail = uniqueEmail("parent-csv");
  const year = new Date().getFullYear() - 9;
  const csv = `prénom,nom,date_naissance,responsable,responsable_email\nZoé,Martin,${year}-05-06,Claire Martin,${parentEmail}\n`;
  await page.goto(`/a/${club}/members/import`);
  await page.locator("#csv-file").setInputFiles({ name: "membres.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Analyser le fichier" }).click();
  await expect(page.getByText(/dont 1 mineur/)).toBeVisible();
  await page.getByLabel(/Je certifie que les membres sans date de naissance/).check();
  await page.getByRole("button", { name: /Importer 1 membre/ }).click();
  await expect(page.getByText(/1 mineur\(s\) : lien d'accord envoyé/)).toBeVisible();
  await waitForMail(parentEmail, "guardian_consent");
});
