import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { createClub, expect, parisToday, signUp, test, uniqueEmail } from "./support/helpers";

/**
 * Récurrences (demande du 2026-10-17) : modifier ou supprimer une séance, elle et les suivantes de sa série, ou toutes les séances à
 * venir de la série. Une séance avec des inscrits est annulée (ils sont prévenus), jamais supprimée en silence.
 * Règles et cas limites : tests/db/session-series.test.ts.
 */
function adminSql() {
  const { adminUrl } = JSON.parse(readFileSync(path.join(os.tmpdir(), `coachos-e2e-db-${process.env.E2E_PORT ?? 3100}.json`), "utf8")) as { adminUrl: string };
  return postgres(adminUrl, { max: 1, onnotice: () => {} });
}

test("série : modifier « cette séance et les suivantes », supprimer « toutes les séances à venir » ; les inscrits sont prévenus, pas effacés", async ({ page }) => {
  await signUp(page, uniqueEmail("serie"), "Gérant Série");
  const club = await createClub(page, "Club Série");
  const sql = adminSql();
  const sessions = () =>
    sql<{ id: string; day: string; hm: string; status: string }[]>`
      select s.id, to_char(s.starts_at at time zone 'Europe/Paris', 'YYYY-MM-DD') as day, to_char(s.starts_at at time zone 'Europe/Paris', 'HH24:MI') as hm, s.status
      from public.sessions s where s.academy_id = ${club} order by s.starts_at`;
  try {
    await test.step("une récurrence de trois séances", async () => {
      await page.goto(`/a/${club}/schedule/new`);
      await page.getByLabel("Date de la première séance").fill(parisToday(1));
      await page.getByLabel("Heure de début").fill("19:00");
      await page.getByLabel("Fréquence").selectOption("weekly");
      for (const day of ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]) await page.getByLabel(day, { exact: true }).check();
      await page.getByLabel("Répéter jusqu'au").fill(parisToday(3));
      await page.getByRole("button", { name: "Créer" }).click();
      await expect(page.getByText("Création effectuée : 3 séances")).toBeVisible();
      expect((await sessions()).map((s) => s.hm)).toEqual(["19:00", "19:00", "19:00"]);
    });

    await test.step("la 2e séance et les suivantes passent à 18:15 ; la 1re ne bouge pas", async () => {
      const [, second] = await sessions();
      await page.goto(`/a/${club}/schedule/${second!.id}`);
      await page.getByLabel("Heure de début").fill("18:15");
      await page.getByRole("radio", { name: /Cette séance et les suivantes de la série \(2 séances\)/ }).check();
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByText("2 séances modifiées")).toBeVisible();
      const after = await sessions();
      expect(after.map((s) => s.hm)).toEqual(["19:00", "18:15", "18:15"]);
      expect(after.map((s) => s.day)).toEqual([parisToday(1), parisToday(2), parisToday(3)]); // chacune garde son jour
    });

    await test.step("suppression de toutes les séances à venir : la séance avec un inscrit est annulée et le garde", async () => {
      const [first, , third] = await sessions();
      const [person] = await sql<{ id: string }[]>`insert into public.people (academy_id, first_name, last_name, adult_attested_at) values (${club}, 'Ines', 'Inscrite', now()) returning id`;
      await sql`insert into public.session_bookings (academy_id, session_id, person_id, status, confirmed_at) values (${club}, ${third!.id}, ${person!.id}, 'booked', now())`;
      await page.goto(`/a/${club}/schedule/${first!.id}`);
      await page.getByRole("button", { name: "Supprimer…" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("radio", { name: /Toutes les séances à venir de la série \(3 séances\)/ }).check();
      await dialog.getByRole("button", { name: "Supprimer" }).click();
      await expect(page.getByText(/2 séances supprimées ; 1 séance annulée au lieu d'être supprimée, car elle avait des inscrits/)).toBeVisible();
      expect(await sessions()).toEqual([expect.objectContaining({ id: third!.id, status: "cancelled" })]);
      expect(await sql`select 1 from public.session_bookings where session_id = ${third!.id} and person_id = ${person!.id}`).toHaveLength(1);
    });

    await test.step("séance seule avec un inscrit : la confirmation l'annonce, elle est annulée au lieu d'être supprimée", async () => {
      await page.goto(`/a/${club}/schedule/new`);
      await page.getByLabel("Date de la première séance").fill(parisToday(5));
      await page.getByLabel("Heure de début").fill("12:00");
      await page.getByRole("button", { name: "Créer" }).click();
      await expect(page.getByText("Création effectuée : 1 séance")).toBeVisible();
      const lone = (await sessions()).find((s) => s.day === parisToday(5))!;
      const [p] = await sql<{ id: string }[]>`select id from public.people where academy_id = ${club} and last_name = 'Inscrite'`;
      await sql`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${club}, ${lone.id}, ${p!.id}, 'waitlisted')`;
      await page.goto(`/a/${club}/schedule/${lone.id}`);
      await expect(page.getByRole("radio")).toHaveCount(0); // pas de série : pas de choix de portée
      await page.getByRole("button", { name: "Supprimer", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("Cette séance a 1 inscrit : elle sera annulée, pas supprimée.");
      await page.getByRole("dialog").getByRole("button", { name: "Supprimer" }).click();
      await expect(page.getByText(/1 séance annulée au lieu d'être supprimée/)).toBeVisible();
      expect((await sessions()).find((s) => s.id === lone.id)?.status).toBe("cancelled");
    });
  } finally {
    await sql.end();
  }
});
