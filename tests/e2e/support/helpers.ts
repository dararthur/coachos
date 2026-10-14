import { expect, test as base, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import os from "node:os";
import path from "node:path";

/**
 * Adresse IP fictive unique : isole les compteurs anti-abus (par IP) entre tests qui partagent la même pile.
 * L'application lit X-Real-IP, que le reverse proxy de confiance (Nginx) écrase en production ; ici le test joue ce rôle.
 */
export const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "x-real-ip": randomIp() });
    await provide(context);
  },
});
export { expect };

export const PASSWORD = `e2e-${randomUUID()}`; // mot de passe jetable, généré à chaque exécution

export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.invalid`;

/** Date du jour dans le fuseau Europe/Paris (celui de l'académie créée par les tests). */
export function parisToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// --- Boîte d'envoi de test (MAIL_PROVIDER=outbox) : l'application y écrit les e-mails au lieu de les envoyer. ---
export const OUTBOX = path.join(os.tmpdir(), `coachos-e2e-outbox-${process.env.E2E_PORT ?? 3100}.jsonl`);
export type Mail = { kind: "verification" | "password_reset" | "club_request" | "club_approved" | "booking_promoted"; to: string; subject: string; link: string };
export const mailsTo = (to: string, kind?: Mail["kind"]): Mail[] =>
  (existsSync(OUTBOX) ? readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean) : []).map((l) => JSON.parse(l) as Mail).filter((m) => m.to === to && (!kind || m.kind === kind));
export async function waitForMail(to: string, kind: Mail["kind"], count = 1): Promise<Mail> {
  await expect.poll(() => mailsTo(to, kind).length, { message: `e-mail ${kind} pour ${to}`, timeout: 15_000 }).toBeGreaterThanOrEqual(count);
  return mailsTo(to, kind).at(-1)!;
}

export const ADMIN_EMAIL = "admin-e2e@example.invalid"; // PLATFORM_ADMIN_EMAIL de la pile de test (tests/e2e/support/run-stack.mjs)

/**
 * Fixture : une demande de club APPROUVÉE pour cette adresse (ce que ferait l'administrateur de la plateforme), directement en base.
 * Sans elle, l'inscription sans code est refusée en silence. Le parcours réel (demande puis approbation) est testé dans club-gating.spec.ts.
 */
export async function approveClub(email: string, name = "Club e2e") {
  const { adminUrl } = JSON.parse(readFileSync(path.join(os.tmpdir(), `coachos-e2e-db-${process.env.E2E_PORT ?? 3100}.json`), "utf8")) as { adminUrl: string };
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into public.academy_requests (name, contact_name, email, status) values (${name}, 'Fondateur e2e', ${email.toLowerCase()}, 'approved')`;
  } finally {
    await sql.end();
  }
}

/** Parcours réel : inscription → e-mail de confirmation (boîte d'envoi) → lien → connexion → onboarding. */
export async function signUp(page: Page, email: string, displayName: string) {
  await approveClub(email);
  await page.goto("/signup");
  await page.getByLabel("Nom affiché").fill(displayName);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText(/Consultez votre boîte mail/)).toBeVisible();
  const mail = await waitForMail(email, "verification");
  await page.goto(mail.link);
  await expect(page).toHaveURL(/\/login\?verified=1/);
  await logIn(page, email, "/onboarding");
  await expect(page).toHaveURL(/\/onboarding/);
}

export async function logIn(page: Page, email: string, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

export async function createClub(page: Page, name: string): Promise<string> {
  await page.getByLabel("Nom du club").fill(name);
  await page.getByRole("button", { name: "Créer le club" }).click();
  await expect(page).toHaveURL(/\/a\/[0-9a-f-]{36}\/dashboard/);
  return /\/a\/([0-9a-f-]{36})\//.exec(page.url())![1]!;
}

/** Après l'acceptation d'une invitation, la fiche est créée automatiquement : « Mon espace » renvoie vers « Mon profil » jusqu'à sa validation. */
export async function completeProfile(page: Page, club: string) {
  await expect(page).toHaveURL(new RegExp(`/a/${club}/profile`));
  const adult = page.getByLabel("Je confirme avoir 18 ans ou plus.");
  if (await adult.count()) await adult.check();
  await page.getByRole("button", { name: "Valider mon profil" }).click();
  await expect(page.getByText("Profil enregistré.")).toBeVisible();
  await page.goto(`/a/${club}/me`);
  await expect(page).toHaveURL(new RegExp(`/a/${club}/me`));
}
