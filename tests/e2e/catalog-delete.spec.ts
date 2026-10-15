import { createClub, expect, parisToday, signUp, test, uniqueEmail } from "./support/helpers";

test("paramètres : supprimer définitivement une discipline ou un type de cours inutilisés ; refus s'ils ont servi", async ({ page }) => {
  await signUp(page, uniqueEmail("catalogue"), "Admin Catalogue");
  const club = await createClub(page, "Club Catalogue");

  // Une discipline et un cours créés pour l'occasion sont supprimés définitivement, après confirmation.
  await page.goto(`/a/${club}/settings#disciplines`);
  await page.getByLabel("Nouvelle discipline").fill("Luta Livre");
  await page.locator("#disciplines").getByRole("button", { name: "Ajouter", exact: true }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Luta Livre" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Supprimer/ }).click();
  const dialog = page.getByRole("dialog", { name: /Supprimer la discipline « Luta Livre »/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Luta Livre" })).toHaveCount(0);

  // Dès qu'une séance utilise le type de cours de départ, la suppression est refusée avec une explication, et rien ne disparaît.
  await page.goto(`/a/${club}/schedule/new`);
  await page.getByLabel("Date de la première séance").fill(parisToday(1));
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.getByText("Création effectuée : 1")).toBeVisible();
  await page.goto(`/a/${club}/settings#cours`);
  await page.getByRole("button", { name: /Supprimer le type de cours JJB/ }).first().click();
  const typeDialog = page.getByRole("dialog", { name: /Supprimer le type de cours « JJB/ });
  await typeDialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(typeDialog.getByText(/Des séances utilisent encore cet élément/)).toBeVisible();
});
