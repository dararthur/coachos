import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import type { Page } from "@playwright/test";
import { completeProfile, createClub, expect, logIn, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

/**
 * Balayage responsive : TOUTES les pages, vues gestionnaire et membre, avec un club rempli de données « difficiles »
 * (noms longs et accentués, e-mail sans coupure possible, actualité avec un mot interminable). Pour chaque taille :
 * aucun défilement horizontal de la page, aucun contrôle hors de l'écran (hors zones prévues pour défiler).
 * Viewport simulé dans Chrome : ce n'est pas un essai sur téléphone ou tablette physique.
 * RESPONSIVE_ALL=1 balaie les 10 tailles de la recette ; par défaut, 5 tailles représentatives.
 */
const ALL = [
  [320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [768, 1024], [1024, 768], [1280, 720], [1440, 900], [1920, 1080],
] as const;
const SIZES = process.env.RESPONSIVE_ALL ? ALL : ([[320, 568], [390, 844], [768, 1024], [1024, 768], [1440, 900]] as const);

function adminSql() {
  const { adminUrl } = JSON.parse(readFileSync(path.join(os.tmpdir(), `coachos-e2e-db-${process.env.E2E_PORT ?? 3100}.json`), "utf8")) as { adminUrl: string };
  return postgres(adminUrl, { max: 1, onnotice: () => {} });
}

async function seed(club: string) {
  const sql = adminSql();
  try {
    await sql`update public.academies set checkin_mode = 'fixed' where id = ${club}`; // affiche du QR fixe (/settings/qr)
    const [ct] = await sql<{ id: string }[]>`select id from public.class_types where academy_id = ${club} order by created_at limit 1`;
    const people: string[] = [];
    for (let i = 0; i < 14; i++) {
      const [p] = await sql<{ id: string }[]>`insert into public.people (academy_id, first_name, last_name, email, phone, adult_attested_at)
        values (${club}, ${i % 2 ? "Marie-Thérèse-Éléonore" : "Jean-Baptiste-Maximilien"}, ${`de La Rochefoucauld-Montmorency ${i}`},
                ${`adresse.electronique.vraiment.tres.longue.${i}@sous-domaine.exemple-de-club-tres-long.invalid`}, '+33612345678', now()) returning id`;
      people.push(p!.id);
    }
    // Historique de grades sur la fiche contrôlée (la carte « Grade et passages » et ses actions par ligne débordaient du téléphone).
    await sql`update public.people set belt = 'blue', belt_stripes = 1 where id = ${people[0]!}`;
    await sql`insert into public.rank_promotions (academy_id, person_id, belt, stripes, promoted_on, date_confirmed, source)
      values (${club}, ${people[0]!}, 'white', 4, current_date - 900, true, 'staff')`;
    const sessions: string[] = [];
    for (const minutes of [20, 26 * 60, 50 * 60, -26 * 60]) {
      const [s] = await sql<{ id: string }[]>`insert into public.sessions (academy_id, class_type_id, starts_at, ends_at, capacity)
        values (${club}, ${ct!.id}, now() + make_interval(mins => ${minutes}), now() + make_interval(mins => ${minutes + 90}), 8) returning id`;
      sessions.push(s!.id);
    }
    for (const p of people.slice(0, 10)) {
      await sql`insert into public.session_bookings (academy_id, session_id, person_id, status) values (${club}, ${sessions[0]!}, ${p}, ${people.indexOf(p) < 8 ? "booked" : "waitlisted"})`;
      await sql`insert into public.attendance (academy_id, session_id, person_id, status) values (${club}, ${sessions[3]!}, ${p}, 'present')`;
    }
    const [post] = await sql<{ id: string }[]>`insert into public.club_posts (academy_id, title, body)
      values (${club}, 'Stage exceptionnel de grappling avec un invité international ce week-end au dojo',
              ${"Inscriptions ouvertes. Lien : https://exemple-de-club-tres-long.invalid/" + "inscription-stage-".repeat(8) + "\n\nApportez votre kimono."}) returning id`;
    return { person: people[0]!, session: sessions[0]!, post: post!.id };
  } finally {
    await sql.end();
  }
}

/** Problèmes de mise en page visibles à cette taille (liste vide = conforme). */
const layoutIssues = (page: Page) =>
  page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""} « ${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40)} »`;
    const scrolls = (el: Element) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if ((ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") && a.scrollWidth > a.clientWidth + 1) return true;
      }
      return false;
    };
    const out: string[] = [];
    const over = document.documentElement.scrollWidth - W;
    if (over > 1) {
      const culprit = [...document.querySelectorAll("main *, header *, nav *")].find((el) => el.getBoundingClientRect().right > W + 1 && !scrolls(el));
      out.push(`page plus large que l'écran de ${over}px${culprit ? ` (ex. ${describe(culprit)})` : ""}`);
    }
    for (const el of document.querySelectorAll("a, button, input, select, textarea, summary")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || el.closest(".sr-only") || scrolls(el)) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (r.right > W + 1 || r.left < -1) out.push(`contrôle hors écran : ${describe(el)}`);
    }
    return out;
  });

async function sweep(page: Page, paths: readonly string[], label: string): Promise<string[]> {
  const problems: string[] = [];
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of paths) {
      const res = await page.goto(p);
      expect(res?.status(), `${p} répond`).toBeLessThan(400);
      for (const issue of await layoutIssues(page)) problems.push(`[${label} ${w}×${h}] ${p} : ${issue}`);
    }
  }
  return problems;
}

test("responsive : aucune page ne déborde, aucun contrôle hors écran (gestionnaire, membre, visiteur)", async ({ page, browser }) => {
  test.setTimeout(process.env.RESPONSIVE_ALL ? 900_000 : 420_000);
  const email = uniqueEmail("resp");
  await signUp(page, email, "Propriétaire au nom vraiment très long pour l'en-tête");
  const club = await createClub(page, "Académie de Jiu-Jitsu Brésilien et de Grappling du Grand Est");
  const { person, session, post } = await seed(club);
  const a = `/a/${club}`;
  const staff = [
    `${a}/dashboard`, `${a}/members`, `${a}/members/${person}`, `${a}/members/new`, `${a}/members/import`, `${a}/schedule`, `${a}/schedule/new`,
    `${a}/schedule/${session}`, `${a}/attendance`, `${a}/attendance/${session}`, `${a}/reports`, `${a}/settings`, `${a}/settings/qr`,
    `${a}/news`, `${a}/news/new`, `${a}/news/${post}`, `${a}/ranking`, "/academies", "/account", "/checkin", "/privacy",
  ];
  // Un second appareil : « Mes appareils connectés » (/account) montre aussi une ligne « Déconnecter » et « Déconnecter tous les autres appareils ».
  const phone = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const phonePage = await phone.newPage();
  await logIn(phonePage, email, "/account");
  await expect(phonePage).toHaveURL(/\/account/);
  await phone.close();
  const problems = await sweep(page, staff, "gestion");

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${a}/dashboard`);
  await page.getByRole("button", { name: "Mode membre" }).click();
  await completeProfile(page, club);
  problems.push(...(await sweep(page, [`${a}/me`, `${a}/profile`, `${a}/schedule`, `${a}/news`, `${a}/news/${post}`, `${a}/ranking`], "membre")));

  const visitor = await browser.newPage();
  problems.push(...(await sweep(visitor, ["/login", "/signup", "/forgot-password", "/join", "/request-club", "/privacy"], "visiteur")));
  await visitor.close();

  expect(problems).toEqual([]);
});
