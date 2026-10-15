import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { completeProfile, createClub, expect, PASSWORD, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

/**
 * Second chemin officiel : l'appareil photo NATIF du téléphone lit le QR et ouvre le lien dans le navigateur, hors de
 * l'application installée. Sur iPhone, Safari n'a pas la session de l'application : on simule ce cas par un contexte
 * vierge (aucun cookie) avec l'identité de Safari iOS. Ce n'est pas un essai sur un iPhone physique.
 */
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("appareil photo natif : le lien de l'affiche ouvre la connexion puis directement la confirmation du cours", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("natif");
  await signUp(page, email, "Membre Natif");
  const club = await createClub(page, "Club Appareil Photo");
  await page.getByRole("button", { name: "Mode membre" }).click();
  await completeProfile(page, club);

  const { adminUrl } = JSON.parse(readFileSync(path.join(os.tmpdir(), `coachos-e2e-db-${process.env.E2E_PORT ?? 3100}.json`), "utf8")) as { adminUrl: string };
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`update public.academies set checkin_mode = 'fixed' where id = ${club}`;
    const [ct] = await sql<{ id: string }[]>`select id from public.class_types where academy_id = ${club} order by created_at limit 1`;
    await sql`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at) values (${club}, ${ct!.id}, now() + interval '10 minutes', now() + interval '100 minutes')`;

    // L'affiche annonce les deux chemins.
    await page.goto(`/a/${club}/settings/qr`);
    await expect(page.getByText("Visez ce code avec l'appareil photo de votre téléphone")).toBeVisible();
    const link = await page.locator("#qr-link").inputValue();

    // « Safari » ouvert par l'appareil photo : pas de session.
    const safari = await browser.newContext({ userAgent: IPHONE_SAFARI, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR", timezoneId: "Europe/Paris", extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const phone = await safari.newPage();
    await phone.goto(new URL(link).pathname);
    await expect(phone).toHaveURL(/\/login\?next=%2Fcheckin%2Fclub%2F[a-f0-9]{24}$/);
    const help = phone.getByRole("status").filter({ hasText: "Vous avez scanné un QR de pointage" });
    await expect(help).toContainText("Sur iPhone, l'appareil photo ouvre Safari");
    await expect(help).not.toContainText("visez-le à nouveau"); // l'affiche fixe n'expire pas
    await phone.getByLabel("Adresse e-mail").fill(email);
    await phone.getByLabel("Mot de passe").fill(PASSWORD);
    await phone.getByRole("button", { name: "Se connecter" }).click();
    await expect(phone).toHaveURL(new RegExp(`${new URL(link).pathname}$`));
    await phone.getByRole("button", { name: "Réserver et confirmer ma présence" }).tap();
    await expect(phone.getByRole("heading", { name: "Présence enregistrée" })).toBeVisible();

    // Scans suivants : la session de « Safari » est conservée, le lien mène droit à la confirmation.
    await phone.goto(new URL(link).pathname);
    await expect(phone).toHaveURL(new RegExp(`${new URL(link).pathname}$`));
    await safari.close();

    const rows = await sql<{ status: string; source: string }[]>`select status, source from public.attendance where academy_id = ${club}`;
    expect(rows).toEqual([{ status: "present", source: "qr" }]);
  } finally {
    await sql.end();
  }
});

test("lien du QR tournant ouvert hors connexion : l'aide rappelle de viser à nouveau le QR s'il a expiré", async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent(`/checkin/${"A".repeat(43)}`)}`);
  const help = page.getByRole("status").filter({ hasText: "Vous avez scanné un QR de pointage" });
  await expect(help).toContainText("visez-le à nouveau");
  await expect(help).toContainText("Sur iPhone");
});
