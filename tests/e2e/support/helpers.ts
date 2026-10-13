import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export const PASSWORD = `e2e-${randomUUID()}`; // mot de passe jetable, généré à chaque exécution

export const uniqueEmail = (label: string) => `${label}-${randomUUID().slice(0, 8)}@example.invalid`;

/** Date du jour dans le fuseau Europe/Paris (celui de l'académie créée par les tests). */
export function parisToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export async function signUp(page: Page, email: string, displayName: string) {
  await page.goto("/signup");
  await page.getByLabel("Nom affiché").fill(displayName);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
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
