import { completeProfile, createClub, expect, PASSWORD, randomIp, signUp, test, uniqueEmail, waitForMail } from "./support/helpers";

test.describe("inscription autonome d'un membre par code ou lien de club", () => {
  test("lien de partage : création du compte, confirmation, connexion, rattachement, fiche automatique ; code saisi à la main ; régénération", async ({ browser }) => {
    // Le coach crée son club et lit le code dans les paramètres.
    const coachCtx = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const coach = await coachCtx.newPage();
    await signUp(coach, uniqueEmail("coach-join"), "Coach Join");
    const club = await createClub(coach, "Club Inscription");
    await coach.goto(`/a/${club}/settings#inscription`);
    const code = (await coach.getByTestId("join-code").innerText()).replace("-", "");
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    await expect(coach.getByLabel("Lien de partage")).toHaveValue(new RegExp(`/join/${code}$`));

    // Le futur membre ouvre le lien sans compte : le code est conservé de l'inscription jusqu'à la connexion.
    const ctx = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const page = await ctx.newPage();
    await page.goto(`/join/${code}`);
    await page.getByRole("link", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Vous allez rejoindre un club.")).toBeVisible();
    const email = uniqueEmail("lea-join");
    await page.getByLabel("Nom affiché").fill("Léa Martin");
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Créer mon compte" }).click();
    await expect(page.getByText("Compte créé.")).toBeVisible();
    await page.goto((await waitForMail(email, "verification")).link);
    await expect(page).toHaveURL(/\/login\?verified=1&next=%2Fjoin%2F/);
    await page.getByLabel("Adresse e-mail").fill(email);
    await page.getByLabel("Mot de passe").fill(PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page).toHaveURL(new RegExp(`/join/${code}`));
    await expect(page.getByText("Club Inscription").first()).toBeVisible();
    await page.getByRole("button", { name: "Rejoindre Club Inscription" }).click();
    // La fiche existe déjà ; il ne reste qu'à valider le profil.
    await expect(page).toHaveURL(new RegExp(`/a/${club}/profile`));
    await expect(page.getByLabel("Prénom")).toHaveValue("Léa");
    await completeProfile(page, club);

    // Côté coach : la fiche est apparue sans aucune action.
    await coach.goto(`/a/${club}/members`);
    await expect(coach.getByText("Martin").first()).toBeVisible();

    // Un compte déjà membre d'un autre club saisit le code à la main (minuscules et tiret tolérés) ; un code erroné est refusé.
    const ctx2 = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const other = await ctx2.newPage();
    await signUp(other, uniqueEmail("manuel"), "Manu Elle");
    await other.goto("/join");
    await other.getByLabel("Code du club").fill("ZZZZ-ZZZZ");
    await other.getByRole("button", { name: "Rejoindre" }).click();
    await expect(other.getByText("Ce code de club est inconnu.")).toBeVisible();
    await other.getByLabel("Code du club").fill(`${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`);
    await other.getByRole("button", { name: "Rejoindre" }).click();
    await expect(other).toHaveURL(new RegExp(`/a/${club}/profile`));

    // Régénération : l'ancien lien ne fonctionne plus.
    await coach.goto(`/a/${club}/settings#inscription`);
    await coach.getByRole("button", { name: "Générer un nouveau code" }).click();
    await coach.getByRole("dialog").getByRole("button", { name: "Générer un nouveau code" }).click();
    await expect(coach.getByTestId("join-code")).not.toHaveText(`${code.slice(0, 4)}-${code.slice(4)}`);
    await other.goto(`/join/${code}`);
    await expect(other.getByText("inconnu ou a été remplacé")).toBeVisible();

    await Promise.all([coachCtx.close(), ctx.close(), ctx2.close()]);
  });
});
