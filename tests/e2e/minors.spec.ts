import { createClub, expect, mailsTo, parisToday, PASSWORD, randomIp, signUp, test, uniqueEmail, waitForMail } from "./support/helpers";

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

test("le responsable retrouve ses enfants sur sa page d'accueil, avec le compte rattaché à l'accord", async ({ page, browser }) => {
  await signUp(page, uniqueEmail("minors-home"), "Coach Accueil");
  const club = await createClub(page, "Club Accueil");
  const parentEmail = uniqueEmail("parent-home");
  await page.goto(`/a/${club}/schedule/new`);
  await page.getByLabel("Date de la première séance").fill(parisToday(1));
  await page.getByLabel("Heure de début").fill("18:30");
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByText("Création effectuée : 1")).toBeVisible();
  const year = new Date().getFullYear() - 16;
  await page.goto(`/a/${club}/members/new`);
  await page.getByLabel("Prénom").fill("Inès");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Durand");
  await page.getByLabel("Type de membre").selectOption("minor");
  await page.getByLabel("Date de naissance").fill(`${year}-02-03`);
  await page.getByLabel("Nom du responsable légal").fill("Paul Durand");
  await page.getByLabel("E-mail du responsable légal").fill(parentEmail);
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByRole("heading", { name: "Inès Durand" })).toBeVisible();
  const mail = await waitForMail(parentEmail, "guardian_consent");

  // Parcours réel du parent, SANS fixture : accord donné sans compte, puis création du compte depuis la page de l'accord
  // (l'adresse du responsable suffit, sans code de club), confirmation de l'e-mail, retour à l'accord, rattachement.
  const ctx = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const parent = await ctx.newPage();
  await parent.goto(mail.link);
  await parent.getByRole("button", { name: "Je confirme mon accord" }).click();
  await expect(parent.getByText("Merci : votre accord est enregistré.")).toBeVisible();
  await parent.getByRole("link", { name: "Créer mon compte" }).click();
  await expect(parent.getByText("Vous êtes le responsable légal")).toBeVisible();
  await parent.getByLabel("Prénom et nom").fill("Paul Durand");
  await parent.getByLabel("Adresse e-mail").fill(parentEmail);
  await parent.getByLabel("Mot de passe").fill(PASSWORD);
  await parent.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(parent.getByText(/Consultez votre boîte mail/)).toBeVisible();
  await parent.goto((await waitForMail(parentEmail, "verification")).link);
  await expect(parent).toHaveURL(/\/login\?verified=1&next=%2Fconsent%2F/);
  await parent.getByLabel("Adresse e-mail").fill(parentEmail);
  await parent.getByLabel("Mot de passe").fill(PASSWORD);
  await parent.getByRole("button", { name: "Se connecter" }).click();
  await expect(parent).toHaveURL(/\/consent\//);
  await parent.getByRole("button", { name: "Suivre Inès avec mon compte" }).click();
  await parent.getByRole("link", { name: "Voir les cours de Inès" }).click();
  await expect(parent).toHaveURL(/\/academies/);
  await expect(parent.getByRole("heading", { name: "Espace parent" })).toBeVisible();
  await expect(parent.getByRole("heading", { name: "Mes enfants" })).toBeVisible();
  await expect(parent.getByText("Inès Durand")).toBeVisible();
  // 16 ans : compte propre possible
  await expect(parent.getByLabel("E-mail de Inès")).toBeHidden();
  await parent.getByText("Donner un compte à Inès").click();
  await expect(parent.getByLabel("E-mail de Inès")).toBeVisible();

  // Le parent réserve puis annule le cours de son enfant.
  await parent.waitForLoadState("networkidle");
  await expect(parent.getByText("Inès n'est inscrit(e) à aucun cours")).toBeVisible();
  // Aucun cours réservé : la liste des cours est dépliée d'emblée (action principale du parent).
  await expect(parent.getByText("Inès n'y apparaît pas.", { exact: false })).toBeVisible();
  await parent.getByRole("button", { name: /Réserver pour Inès/ }).click();
  // Le cours réservé remonte dans la liste toujours visible des cours de l'enfant.
  await expect(parent.getByText("Inscrit", { exact: true })).toBeVisible();
  await parent.getByRole("button", { name: /Annuler pour Inès/ }).click();
  await expect(parent.getByText("Inès n'est inscrit(e) à aucun cours")).toBeVisible();
  await ctx.close();
});
