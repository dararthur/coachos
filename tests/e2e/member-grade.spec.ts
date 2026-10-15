import { createClub, expect, signUp, test, uniqueEmail } from "./support/helpers";

test("l'administrateur renseigne la ceinture et les barrettes depuis la fiche du membre", async ({ page }) => {
  await signUp(page, uniqueEmail("grade"), "Coach Grade");
  const club = await createClub(page, "Club Grades");
  await page.goto(`/a/${club}/members/new`);
  await page.getByLabel("Prénom").fill("Paul");
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Grade");
  await page.getByLabel("Type de membre").selectOption("adult");
  await page.getByLabel("Je confirme que ce membre est majeur.").check();
  await page.getByRole("button", { name: "Créer le membre" }).click();
  await expect(page.getByRole("heading", { name: "Paul Grade" })).toBeVisible();
  await expect(page.getByText("Grade non renseigné")).toBeVisible();
  await page.waitForLoadState("networkidle");

  await page.getByLabel("Ceinture").selectOption("purple");
  await page.getByLabel("Barrettes").selectOption("2");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Fiche mise à jour.")).toBeVisible();

  // Même ceinture dans la liste des membres.
  await page.goto(`/a/${club}/members`);
  await expect(page.getByRole("img", { name: "Ceinture violette, 2 barrettes" }).first()).toBeVisible();
});
