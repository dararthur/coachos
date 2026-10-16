import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import type { Browser, Page } from "@playwright/test";
import { ADMIN_EMAIL, approveClub, expect, logIn, mailsTo, PASSWORD, randomIp, test, uniqueEmail, waitForMail } from "./support/helpers";

const NO_CODE_MESSAGE = /Si cette adresse peut créer un compte/;

async function visitor(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ locale: "fr-FR", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  return ctx.newPage();
}

async function fillSignup(page: Page, email: string, code?: string) {
  await page.goto("/signup");
  if (code !== undefined) await page.getByLabel("Code du club").fill(code);
  await page.getByLabel("Prénom et nom").fill("Test Gating");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
}

test.describe.configure({ mode: "serial" });

test.describe("création de club sur approbation et inscription sur ticket", () => {
  test("sans ticket : réponse neutre, aucun e-mail, aucun compte ; code erroné signalé", async ({ browser }) => {
    const page = await visitor(browser);
    const email = uniqueEmail("sans-ticket");
    await fillSignup(page, email);
    await expect(page.getByText(NO_CODE_MESSAGE)).toBeVisible();
    await page.waitForTimeout(800);
    expect(mailsTo(email)).toHaveLength(0);
    await logIn(page, email);
    await expect(page.getByRole("alert")).toBeVisible(); // aucun compte : identifiants refusés

    // Un code erroné est signalé explicitement (le code est un secret partagé, pas une adresse).
    const wrong = await visitor(browser);
    await fillSignup(wrong, uniqueEmail("mauvais-code"), "ZZZZ-ZZZZ");
    await expect(wrong.getByText("Ce code de club est inconnu").first()).toBeVisible();
  });

  test("parcours complet : demande publique, e-mail à l'administrateur, approbation, compte, création du club", async ({ browser }) => {
    // 1. L'administrateur de la plateforme crée son compte (seule adresse admise sans ticket) : la réponse est la même que pour tout le monde.
    const admin = await visitor(browser);
    await fillSignup(admin, ADMIN_EMAIL);
    await expect(admin.getByText(NO_CODE_MESSAGE)).toBeVisible();
    await admin.goto((await waitForMail(ADMIN_EMAIL, "verification")).link);
    await logIn(admin, ADMIN_EMAIL, "/admin/club-requests");
    await expect(admin.getByRole("heading", { name: "Demandes de création de club" })).toBeVisible();

    // 2. Un futur propriétaire dépose une demande, sans compte.
    const founderEmail = uniqueEmail("fondateur");
    const founder = await visitor(browser);
    await founder.goto("/request-club");
    await founder.getByLabel("Nom du club").fill("Gracie Test Club");
    await founder.getByLabel("Votre nom").fill("Camille Fondatrice");
    await founder.getByLabel("Votre adresse e-mail").fill(founderEmail);
    await founder.getByRole("button", { name: "Envoyer ma demande" }).click();
    await expect(founder.getByText("Votre demande a bien été transmise.")).toBeVisible();
    expect(mailsTo(founderEmail)).toHaveLength(0); // la demande seule ne déclenche rien côté demandeur

    // 3. L'administrateur reçoit l'e-mail et voit la demande.
    const notice = await waitForMail(ADMIN_EMAIL, "club_request");
    expect(notice.link).toMatch(/\/admin\/club-requests$/);
    await admin.goto(notice.link);
    const card = admin.getByTestId("club-request").filter({ hasText: "Gracie Test Club" });
    await expect(card).toBeVisible();
    await expect(card).toContainText(founderEmail);

    // 4. Un autre compte, même confirmé, ne voit pas cette page : elle n'existe pas pour lui.
    const stranger = await visitor(browser);
    const strangerEmail = uniqueEmail("curieux");
    await approveClub(strangerEmail);
    await fillSignup(stranger, strangerEmail);
    await stranger.goto((await waitForMail(strangerEmail, "verification")).link);
    await logIn(stranger, strangerEmail, "/admin/club-requests");
    await expect(stranger.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    await expect(stranger.getByRole("heading", { name: "Demandes de création de club" })).toHaveCount(0);
    await stranger.goto("/admin");
    await expect(stranger.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    await expect(stranger.getByRole("heading", { name: "Administration de la plateforme" })).toHaveCount(0);
    await stranger.goto("/account");
    await expect(stranger.getByRole("heading", { name: "Mon compte", exact: true })).toBeVisible();
    await expect(stranger.getByText("Administration de la plateforme")).toHaveCount(0);

    // 5. Approbation : le demandeur reçoit un e-mail et peut créer son compte SANS code.
    await card.getByRole("button", { name: "Approuver" }).click();
    await expect(card).toContainText("Approuvée");
    const approved = await waitForMail(founderEmail, "club_approved");
    expect(approved.link).toMatch(/\/signup$/);
    await fillSignup(founder, founderEmail);
    await expect(founder.getByText(NO_CODE_MESSAGE)).toBeVisible();
    await founder.goto((await waitForMail(founderEmail, "verification")).link);
    await logIn(founder, founderEmail, "/onboarding");

    // 6. Le club approuvé est proposé, formulaire prérempli ; création.
    await expect(founder.getByRole("heading", { name: "Votre club est approuvé" })).toBeVisible();
    await expect(founder.getByLabel("Nom du club")).toHaveValue("Gracie Test Club");
    await founder.getByRole("button", { name: "Créer le club" }).click();
    await expect(founder).toHaveURL(/\/a\/[0-9a-f-]{36}\/dashboard/);

    // 7. L'administrateur retrouve ce club dans la console (par son lien dans « Mon compte »), avec des compteurs et le contact du propriétaire, sans donnée de membre.
    await admin.goto("/account");
    await admin.getByRole("link", { name: "Ouvrir l'administration" }).click();
    await expect(admin).toHaveURL(/\/admin$/);
    await expect(admin.getByRole("heading", { name: "Administration de la plateforme" })).toBeVisible();
    const row = admin.getByTestId("platform-club").filter({ hasText: "Gracie Test Club" });
    await expect(row).toBeVisible();
    await expect(row).toContainText(founderEmail);
    await expect(row).toContainText("Inactif");
  });

  test("compte sans club : par défaut on rejoint ; créer un club est discret et mène à la demande", async ({ browser }) => {
    const page = await visitor(browser);
    const email = uniqueEmail("membre");
    await approveClub(email);
    await fillSignup(page, email);
    await page.goto((await waitForMail(email, "verification")).link);
    // Le compte n'a plus de demande approuvée à réclamer : on la retire pour simuler un simple compte sans club.
    const { adminUrl } = JSON.parse(readFileSync(path.join(os.tmpdir(), `coachos-e2e-db-${process.env.E2E_PORT ?? 3100}.json`), "utf8")) as { adminUrl: string };
    const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
    await sql`delete from public.academy_requests where email = ${email}`;
    await sql.end();
    await logIn(page, email, "/onboarding");
    await expect(page.getByRole("heading", { name: "Rejoignez votre club" })).toBeVisible();
    await expect(page.getByLabel("Code du club")).toBeVisible();
    await expect(page.getByLabel("Nom du club")).toHaveCount(0);
    await page.getByRole("link", { name: "Demander sa création" }).click();
    await expect(page).toHaveURL(/\/request-club/);
  });
});
