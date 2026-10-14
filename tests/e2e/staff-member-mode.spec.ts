import { completeProfile, createClub, expect, parisToday, signUp, test, uniqueEmail } from "./support/helpers";

test.describe("équipe : coach inscrit d'office et mode membre", () => {
  test("le coach affecté figure parmi les inscrits (filtre par défaut), la durée suit le type, le mode membre permet de réserver une autre séance", async ({ page }) => {
    await signUp(page, uniqueEmail("coach-mode"), "Coach Mode");
    const club = await createClub(page, "Club Mode Membre");
    const day = parisToday(1);

    // Séance 1 : coach affecté ; la durée est préremplie avec celle du type de cours (60 min pour « JJB — Tous niveaux »).
    await page.goto(`/a/${club}/schedule/new`);
    await expect(page.getByLabel("Durée (minutes)")).toHaveValue("60");
    await page.getByLabel("Coach", { exact: true }).selectOption({ index: 1 });
    await page.getByLabel("Date de la première séance").fill(day);
    await page.getByLabel("Heure de début").fill("18:30");
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Création effectuée : 1")).toBeVisible();

    // Séance 2 : sans coach, le même jour à une autre heure, pour réserver en mode membre.
    await page.goto(`/a/${club}/schedule/new`);
    await page.getByLabel("Date de la première séance").fill(day);
    await page.getByLabel("Heure de début").fill("20:00");
    await page.getByRole("button", { name: "Créer" }).click();
    await expect(page.getByText("Création effectuée : 1")).toBeVisible();

    // Feuille d'appel de la séance 1 : le coach est inscrit d'office et le filtre par défaut est « Inscrits ».
    await page.goto(`/a/${club}/schedule?week=${day}`);
    await page.getByRole("link", { name: "Appel" }).first().click();
    await expect(page.getByRole("button", { name: /^Inscrits/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("listitem").filter({ hasText: "Coach" }).getByText("Inscrit", { exact: true })).toBeVisible();

    // Mode membre : la fiche d'adhérent est créée, à valider une fois ; le planning propose la réservation.
    await page.getByRole("button", { name: "Mode membre" }).click();
    await completeProfile(page, club);
    await expect(page.getByRole("button", { name: "Mode coach" })).toBeVisible();
    await page.goto(`/a/${club}/schedule?week=${day}`);
    await expect(page.getByRole("link", { name: "Nouvelle séance" })).toHaveCount(0); // plus de commandes de gestion en mode membre
    await page.getByRole("button", { name: "Réserver" }).click();
    await expect(page.getByText("Inscrit", { exact: true }).first()).toBeVisible();

    // Retour au mode coach : tableau de bord, commandes de gestion de retour.
    await page.getByRole("button", { name: "Mode coach" }).click();
    await expect(page).toHaveURL(new RegExp(`/a/${club}/dashboard`));
    await page.goto(`/a/${club}/schedule?week=${day}`);
    await expect(page.getByRole("link", { name: "Nouvelle séance" }).first()).toBeVisible();

    // Rapports : second export CSV, le classement de la période (nombre de présences de chaque membre entre deux dates).
    const response = await page.request.get(`/a/${club}/reports/ranking-export?from=${parisToday(-30)}&to=${parisToday(30)}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");
    expect(response.headers()["content-disposition"]).toContain("classement-");
    expect((await response.text()).split("\n")[0]).toContain("Rang");
    await page.goto(`/a/${club}/reports`);
    await expect(page.getByRole("link", { name: "Classement de la période (CSV)" })).toBeVisible();
  });
});
