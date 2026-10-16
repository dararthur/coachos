import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import type { Browser, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ADMIN_EMAIL, approveClub, expect, logIn, mailsTo, PASSWORD, randomIp, test, uniqueEmail, unlockAdmin, waitForMail } from "./support/helpers";

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
    // Mot de passe seul ne suffit pas : l'administration demande un code reçu par e-mail.
    await expect(admin).toHaveURL(/\/admin\/security\?next=%2Fadmin%2Fclub-requests/);
    await expect(admin.getByRole("heading", { name: "Demandes de création de club" })).toHaveCount(0);
    await admin.getByRole("button", { name: "Envoyer le code par e-mail" }).click();
    const first = await waitForMail(ADMIN_EMAIL, "admin_code");
    expect(first.code).toMatch(/^\d{6}$/);
    await admin.getByLabel("Code à 6 chiffres").fill(first.code === "000000" ? "111111" : "000000");
    await admin.getByRole("button", { name: "Ouvrir l'administration" }).click();
    await expect(admin.getByText("Code incorrect, expiré ou déjà utilisé.")).toBeVisible();
    await admin.getByLabel("Code à 6 chiffres").fill(first.code!);
    await admin.getByRole("button", { name: "Ouvrir l'administration" }).click();
    await expect(admin.getByRole("heading", { name: "Demandes de création de club" })).toBeVisible();
    // Le code ne sert qu'une fois : un nouvel appareil (autre session) avec le même code est refusé, et doit demander le sien.
    const other = await visitor(browser);
    await logIn(other, ADMIN_EMAIL, "/admin");
    await expect(other).toHaveURL(/\/admin\/security/);
    await other.goto("/admin");
    await expect(other).toHaveURL(/\/admin\/security/);
    await unlockAdmin(other);
    await expect(other.getByRole("heading", { name: "Administration de la plateforme" })).toBeVisible();
    // Verrouiller efface la preuve de cet appareil.
    await other.goto("/admin/security");
    await other.getByRole("button", { name: "Verrouiller sur cet appareil" }).click();
    await expect(other).toHaveURL(/\/account/);
    await other.goto("/admin");
    await expect(other).toHaveURL(/\/admin\/security/);

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
    await stranger.goto("/admin/security");
    await expect(stranger.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
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
    // Un club créé à l'instant est « en démarrage » : rien à surveiller ; la courbe sur 13 mois est là.
    await expect(admin.getByRole("heading", { name: "Clubs à surveiller" })).toBeVisible();
    await expect(admin.getByTestId("watch-item").filter({ hasText: "Gracie Test Club" })).toHaveCount(0);
    await expect(admin.getByRole("heading", { name: "Usage par mois" })).toBeVisible();
    // Supervision : état des tâches planifiées et compteurs d'envois (les e-mails de ce parcours sont déjà comptés).
    await expect(admin.getByTestId("job-reminders")).toContainText("Rappels de séance");
    await expect(admin.getByTestId("job-purge")).toContainText("Purge de rétention");
    await expect(admin.getByTestId("metric-mail_sent")).toContainText("E-mails envoyés");
    await expect(admin.getByTestId("metric-mail_failed")).toBeVisible();

    // 8. Il coupe les actualités pour ce club : navigation, page et serveur les refusent, sans rien supprimer ; la réactivation les rend.
    await row.getByRole("link", { name: "Gracie Test Club" }).click();
    await expect(admin.getByRole("heading", { name: "Gracie Test Club" })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Usage par mois" })).toBeVisible();
    const news = admin.getByTestId("feature-news");
    await expect(news).toContainText("Activé");
    const clubHome = new URL(founder.url()).pathname.replace(/\/dashboard.*$/, "");
    await founder.goto(`${clubHome}/dashboard`);
    await expect(founder.getByRole("link", { name: "Actualités" }).first()).toBeVisible();

    await news.getByRole("button", { name: "Couper" }).click();
    await expect(news).toContainText("Coupé");
    await founder.goto(`${clubHome}/dashboard`);
    await expect(founder.getByRole("link", { name: "Actualités" })).toHaveCount(0);
    await founder.goto(`${clubHome}/news`);
    await expect(founder.getByRole("heading", { name: "Non incluse dans votre formule" })).toBeVisible();
    await founder.goto(`${clubHome}/news/new`);
    await expect(founder.getByRole("heading", { name: "Non incluse dans votre formule" })).toBeVisible();
    // Les autres modules ne sont pas touchés.
    await founder.goto(`${clubHome}/reports`);
    await expect(founder.getByRole("heading", { name: "Rapports", exact: true })).toBeVisible();

    // Les pages d'administration respectent l'accessibilité (axe, WCAG AA) et ne débordent pas sur téléphone.
    const clubId = clubHome.split("/").pop()!;
    for (const path of ["/admin", `/admin/clubs/${clubId}`, "/admin/club-requests", "/admin/security"]) {
      await admin.goto(path);
      await admin.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page: admin }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`), `${path} : violations axe`).toEqual([]);
      await admin.setViewportSize({ width: 375, height: 812 });
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} déborde de ${overflow}px sur téléphone`).toBeLessThanOrEqual(1);
      await admin.setViewportSize({ width: 1280, height: 720 });
    }
    await admin.goto(`/admin/clubs/${clubId}`);

    await news.getByRole("button", { name: "Activer" }).click();
    await expect(news).toContainText("Activé");
    await founder.goto(`${clubHome}/news`);
    await expect(founder.getByRole("heading", { name: "Actualités", exact: true })).toBeVisible();
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
