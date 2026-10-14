import type { Browser, Page } from "@playwright/test";
import { completeProfile, createClub, expect, parisToday, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  return context.newPage();
}

/** Inscription autonome par code, puis profil validé. */
async function joinAsMember(browser: Browser, club: string, code: string, displayName: string): Promise<Page> {
  const page = await newPage(browser);
  await signUp(page, uniqueEmail("resa"), displayName);
  await page.goto("/join");
  await page.getByLabel("Code du club").fill(code);
  await page.getByRole("button", { name: "Rejoindre" }).click();
  await completeProfile(page, club);
  return page;
}

test.describe("réservation des séances, liste d'attente, absence des inscrits non venus", () => {
  test("réserver, liste d'attente, place accordée par le coach, annulation, validation de la feuille", async ({ browser }) => {
    const coach = await newPage(browser);
    await signUp(coach, uniqueEmail("coach-resa"), "Coach Resa");
    const club = await createClub(coach, "Club Réservations");
    await coach.goto(`/a/${club}/settings#inscription`);
    const code = (await coach.getByTestId("join-code").innerText()).replace("-", "");

    // Une séance demain, 1 seule place.
    const day = parisToday(1);
    await coach.goto(`/a/${club}/schedule/new`);
    await coach.getByLabel("Date de la première séance").fill(day);
    await coach.getByLabel("Heure de début").fill("18:30");
    await coach.getByLabel("Capacité").fill("1");
    await coach.getByRole("button", { name: "Créer" }).click();
    await expect(coach.getByText("Création effectuée : 1")).toBeVisible();

    const alice = await joinAsMember(browser, club, code, "Alice Resa");
    const bruno = await joinAsMember(browser, club, code, "Bruno Resa");

    // Alice réserve : confirmée. Bruno : la séance est pleine, il passe en liste d'attente (sans être bloqué).
    await alice.goto(`/a/${club}/schedule?week=${day}`);
    await alice.getByRole("button", { name: "Réserver" }).click();
    await expect(alice.getByText("Inscrit", { exact: true })).toBeVisible();

    await bruno.goto(`/a/${club}/schedule?week=${day}`);
    // Séance pleine : le bouton annonce la liste d'attente avant l'inscription, et le rappel dit qu'aucune notification ne suivra.
    await bruno.getByRole("button", { name: "Rejoindre la liste d'attente" }).click();
    await expect(bruno.getByText("Liste d'attente · n°1")).toBeVisible();
    await expect(bruno.getByText(/sans notification/)).toBeVisible();

    // « Mon espace » propose la même réservation.
    await bruno.goto(`/a/${club}/me`);
    await expect(bruno.getByText("Liste d'attente · n°1")).toBeVisible();

    // Le coach voit les inscrits sur le planning, puis sur la feuille d'appel.
    await coach.goto(`/a/${club}/schedule?week=${day}`);
    await expect(coach.getByText("1/1 inscrit · 1 en attente")).toBeVisible();
    await coach.getByRole("link", { name: "Appel" }).click();
    const aliceRow = coach.getByRole("listitem").filter({ hasText: "Alice" });
    const brunoRow = coach.getByRole("listitem").filter({ hasText: "Bruno" });
    await expect(aliceRow.getByText("Inscrit", { exact: true })).toBeVisible();
    await expect(brunoRow.getByText("Liste d'attente")).toBeVisible();

    // Le coach accorde une place à Bruno (au-delà de la capacité).
    await brunoRow.getByRole("button", { name: "Accorder une place" }).click();
    await expect(brunoRow.getByText("Inscrit", { exact: true })).toBeVisible();

    // Alice annule tant que la feuille n'est pas validée.
    await alice.goto(`/a/${club}/schedule?week=${day}`);
    await alice.getByRole("button", { name: "Annuler" }).click();
    // Bruno occupe désormais l'unique place : Alice ne peut plus que rejoindre la liste d'attente.
    await expect(alice.getByRole("button", { name: "Rejoindre la liste d'attente" })).toBeVisible();

    // Validation : Bruno, inscrit sans présence, devient absent. La feuille prévient le coach.
    await coach.getByRole("button", { name: /Valider/ }).click();
    await expect(coach.getByRole("dialog").getByText("1 inscrit sans présence enregistrée sera marqué absent.")).toBeVisible();
    await coach.getByRole("dialog").getByRole("button", { name: "Valider la feuille" }).click();
    await expect(coach.getByText("Feuille validée")).toBeVisible();
    await expect(brunoRow.getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");

    // Après validation, Bruno ne peut plus annuler.
    await bruno.goto(`/a/${club}/schedule?week=${day}`);
    await bruno.getByRole("button", { name: "Annuler" }).click();
    await expect(bruno.getByRole("alert").filter({ hasText: "validée" })).toBeVisible();
  });
});
