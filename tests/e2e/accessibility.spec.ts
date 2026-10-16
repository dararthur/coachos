import AxeBuilder from "@axe-core/playwright";
import { createClub, expect, parisToday, signUp, test, uniqueEmail } from "./support/helpers";

/** Contrôles d'accessibilité automatisés (axe, WCAG 2.1 A/AA) + parcours clavier de base. Ne remplace pas un audit manuel. */
const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoViolations(page: import("@playwright/test").Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const summary = results.violations.map((v) => `${v.id} (${v.impact}) : ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `${label} : violations axe`).toEqual([]);
}

test("pages publiques et authentifiées sans violation axe (WCAG AA)", async ({ page }) => {
  for (const path of ["/login", "/signup", "/forgot-password", "/privacy"]) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }

  await signUp(page, uniqueEmail("a11y"), "Accessibilité");
  await expectNoViolations(page, "/onboarding");
  const club = await createClub(page, "Club Accessible");

  // données minimales pour que les listes/tableaux soient rendus
  await page.goto(`/a/${club}/members/new`);
  await page.getByLabel("Prénom").fill("Ada");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Lovelace");
  await page.getByLabel("Type de membre").selectOption("adult");
  await page.getByLabel("Je confirme que ce membre est majeur.").check();
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
  await expectNoViolations(page, "fiche membre");

  await page.goto(`/a/${club}/schedule/new`);
  await page.getByLabel("Date de la première séance").fill(parisToday());
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByText("Création effectuée")).toBeVisible();

  for (const path of ["dashboard", "members", "members/new", "members/import", "schedule", "schedule/new", "attendance", "reports", "settings"]) {
    await page.goto(`/a/${club}/${path}`);
    await expectNoViolations(page, path);
  }
  await page.goto(`/a/${club}/attendance`);
  await page.getByRole("link", { name: "Faire l'appel" }).first().click();
  await expect(page.getByRole("group", { name: "Présence de Ada Lovelace" })).toBeVisible();
  await expectNoViolations(page, "feuille d'appel");
  await page.goto("/account");
  await expectNoViolations(page, "/account");
  await page.goto("/checkin");
  await expectNoViolations(page, "/checkin");
  await page.goto(`/checkin/${"A".repeat(43)}`);
  await expectNoViolations(page, "/checkin/<jeton invalide>");
});

test("navigation au clavier : lien d'évitement, formulaire de connexion et fermeture de modale par Échap", async ({ page, browserName }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Adresse e-mail")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Mot de passe")).toBeFocused();
  // Le bouton « Afficher » du mot de passe est atteignable au clavier, juste après le champ.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Afficher le mot de passe" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeFocused();

  await signUp(page, uniqueEmail("kbd"), "Clavier");
  const club = await createClub(page, "Club Clavier");
  await page.goto(`/a/${club}/dashboard`);
  const skipLink = page.getByRole("link", { name: "Aller au contenu" });
  // WebKit (Safari) : par défaut, Tab ne parcourt que boutons et champs, jamais les liens (réglage « Appuyer sur Tab pour mettre
  // en évidence chaque élément », désactivé ; Option+Tab n'est pas émulé par Playwright). Le chemin clavier jusqu'au lien est
  // prouvé dans Chromium et Firefox ; ici, le lien prend le focus et fonctionne à la touche Entrée.
  if (browserName === "webkit") await skipLink.focus();
  else await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#contenu$/);

  await page.goto("/account");
  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Supprimer mon compte" })).toBeFocused(); // le focus revient au déclencheur
});

test("mise en page mobile : pas de défilement horizontal de la page", async ({ page }) => {
  await signUp(page, uniqueEmail("mobile"), "Mobile");
  const club = await createClub(page, "Club Mobile");
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["dashboard", "members", "schedule", "attendance", "reports", "settings"]) {
    await page.goto(`/a/${club}/${path}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} déborde de ${overflow}px`).toBeLessThanOrEqual(1);
  }
});
