import type { Browser, Page } from "@playwright/test";
import { completeProfile, createClub, expect, parisToday, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: "fr-FR", timezoneId: "Europe/Paris", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  return context.newPage();
}

/** Heure de Paris (HH:MM) dans `minutes` minutes. */
function parisTimeIn(minutes: number): { date: string; time: string } {
  const d = new Date(Date.now() + minutes * 60_000);
  const parts = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

test.describe("pointage par QR fixe du club", () => {
  test("le cours est retrouvé par l'heure, réservation et pointage en un geste, régénération du QR", async ({ browser }) => {
    const coach = await newPage(browser);
    await signUp(coach, uniqueEmail("coach-fixe"), "Coach Fixe");
    const club = await createClub(coach, "Club QR Fixe");

    // Mode QR fixe.
    await coach.goto(`/a/${club}/settings#pointage`);
    await coach.waitForLoadState("networkidle");
    await coach.getByLabel("Mode de pointage").selectOption("fixed");
    await coach.getByRole("button", { name: "Enregistrer" }).last().click();
    await expect(coach.getByText("Réglages du pointage enregistrés.")).toBeVisible();

    // Un cours qui commence dans 10 minutes, ou qui a commencé il y a 10 minutes s'il est presque minuit : toujours le jour même
    // (dans les deux cas, la fenêtre de pointage, 45 min avant à 30 min après, est ouverte).
    const { date, time } = parisTimeIn(parisTimeIn(10).date === parisToday(0) ? 10 : -10);
    expect(date).toBe(parisToday(0));
    await coach.goto(`/a/${club}/schedule/new`);
    await coach.getByLabel("Date de la première séance").fill(date);
    await coach.getByLabel("Heure de début").fill(time);
    await coach.getByRole("button", { name: "Créer" }).click();
    await expect(coach.getByText("Création effectuée : 1")).toBeVisible();

    // L'affiche porte le lien du QR.
    await coach.goto(`/a/${club}/settings/qr`);
    await expect(coach.getByRole("heading", { name: "Club QR Fixe" })).toBeVisible();
    const link = await coach.locator("#qr-link").inputValue();
    expect(link).toMatch(/\/checkin\/club\/[a-f0-9]{24}$/);

    // Un adhérent rejoint le club, puis scanne l'affiche.
    await coach.goto(`/a/${club}/settings#inscription`);
    const code = (await coach.getByTestId("join-code").innerText()).replace("-", "");
    const member = await newPage(browser);
    await signUp(member, uniqueEmail("fixe"), "Alice Fixe");
    await member.goto("/join");
    await member.getByLabel("Code du club").fill(code);
    await member.getByRole("button", { name: "Rejoindre" }).click();
    await completeProfile(member, club);

    await member.goto(new URL(link).pathname);
    await member.waitForLoadState("networkidle");
    await expect(member.getByText("Vous n'avez pas encore réservé ce cours.")).toBeVisible();
    await member.getByRole("button", { name: "Réserver et confirmer ma présence" }).click();
    await expect(member.getByTestId("checkin-success")).toContainText("Présence enregistrée");

    // Le coach voit la présence arriver ; la feuille précise le mode.
    await coach.goto(`/a/${club}/attendance`);
    await coach.getByRole("link", { name: "Appel" }).first().click();
    await expect(coach.getByText("Pointage par QR fixe")).toBeVisible();
    await expect(coach.getByRole("listitem").filter({ hasText: "Alice" }).getByRole("button", { name: "Présent" })).toHaveAttribute("aria-pressed", "true");

    // Régénérer le QR : l'ancienne affiche ne fonctionne plus.
    await coach.goto(`/a/${club}/settings#pointage`);
    await coach.waitForLoadState("networkidle");
    await coach.getByRole("button", { name: "Régénérer le QR" }).click();
    await coach.getByRole("dialog").getByRole("button", { name: "Régénérer le QR" }).click();
    await expect(coach.getByRole("dialog")).toBeHidden();
    await member.goto(new URL(link).pathname);
    await expect(member.getByText("QR code invalide")).toBeVisible();
  });
});
