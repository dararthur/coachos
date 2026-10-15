import type { Page } from "@playwright/test";
import { createClub, expect, logIn, parisToday, signUp, test, uniqueEmail } from "./support/helpers";

/**
 * PWA et parcours mobile. Ces tests utilisent l'ÉMULATION d'un téléphone (viewport, tactile, user-agent mobile) dans Chrome :
 * ils ne remplacent pas un essai sur appareil physique (voir docs/pwa.md).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

/** PNG : lit la largeur/hauteur dans l'en-tête IHDR. */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function noHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} déborde de ${overflow}px`).toBeLessThanOrEqual(1);
}

/** Cibles tactiles : boutons, champs et onglets d'au moins 44 × 44 px (liens en ligne dans un texte exclus). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const selector = "main button, main select, main textarea, main input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]), nav a, aside a, main a.inline-flex, main td a, main th a, main li a, [role=group] button";
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden" || el.closest("[hidden], .sr-only")) continue;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} « ${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("name") || "").trim().slice(0, 30)} » ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    for (const box of document.querySelectorAll<HTMLInputElement>("main input[type=checkbox], main input[type=radio]")) {
      const label = box.closest("label") ?? (box.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(box.id)}"]`) : null);
      const r = (label ?? box).getBoundingClientRect();
      if (r.height < 43.5 && r.width > 0) out.push(`${box.type} « ${(label?.textContent ?? "").trim().slice(0, 30)} » ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
}

test.describe("PWA : manifeste, icônes, métadonnées", () => {
  test("manifeste valide, icônes réelles, métadonnées iOS/Android, aucun service worker", async ({ page, request }) => {
    const res = await page.goto("/login");
    expect(res?.status()).toBe(200);

    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(href).toBe("/manifest.webmanifest");
    const manifestRes = await request.get("/manifest.webmanifest"); // accessible sans session
    expect(manifestRes.status()).toBe(200);
    expect(manifestRes.headers()["content-type"]).toContain("manifest+json");
    const manifest = await manifestRes.json();
    expect(manifest).toMatchObject({ name: "Matnexa", short_name: "Matnexa", display: "standalone", start_url: "/", scope: "/", lang: "fr", theme_color: "#16191d" });

    const purposes = new Set<string>();
    const sizes: number[] = [];
    for (const icon of manifest.icons as { src: string; sizes: string; type: string; purpose: string }[]) {
      const r = await request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()["content-type"]).toBe("image/png");
      const dim = pngSize(await r.body());
      const [w] = icon.sizes.split("x").map(Number);
      expect(dim, icon.src).toEqual({ w, h: w });
      purposes.add(icon.purpose);
      sizes.push(w!);
    }
    expect([...purposes].sort()).toEqual(["any", "maskable"]);
    expect(sizes).toEqual(expect.arrayContaining([192, 512]));

    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(apple).toContain("apple-touch-icon.png");
    expect(pngSize(await (await request.get(apple!)).body())).toEqual({ w: 180, h: 180 });

    expect(await page.locator('meta[name="apple-mobile-web-app-capable"], meta[name="mobile-web-app-capable"]').count()).toBeGreaterThan(0);
    expect(await page.locator('meta[name="apple-mobile-web-app-title"]').getAttribute("content")).toBe("Matnexa");
    expect(await page.locator('meta[name="theme-color"]').first().getAttribute("content")).toBe("#16191d");
    expect(await page.locator('meta[name="viewport"]').getAttribute("content")).toContain("viewport-fit=cover");

    // Aucun cache hors ligne de données authentifiées : pas de service worker enregistré.
    const registrations = await page.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length ?? 0);
    expect(registrations).toBe(0);
    expect((await request.get("/sw.js")).status()).toBe(404);
  });

  test("les pages authentifiées ne sont pas mises en cache par le navigateur ni un CDN", async ({ page }) => {
    await signUp(page, uniqueEmail("cache"), "Cache");
    const club = await createClub(page, "Club Cache");
    const res = await page.goto(`/a/${club}/members`);
    const cc = res!.headers()["cache-control"] ?? "";
    expect(cc).toMatch(/no-store|no-cache|private/);
    expect(cc).not.toMatch(/public|s-maxage/);
  });
});

test.describe("parcours mobiles", () => {
  test("propriétaire : connexion, tableau de bord, planning, appel au doigt, membres", async ({ page }) => {
    const email = uniqueEmail("mob-owner");
    await signUp(page, email, "Mobile Owner");
    const club = await createClub(page, "Club Mobile");

    // navigation : barre d'onglets en bas, pas de menu latéral
    const tabs = page.getByRole("navigation", { name: "Navigation principale" });
    await expect(tabs).toBeVisible();
    const box = await tabs.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(844 - 2); // collée au bas de l'écran
    await expect(tabs.getByRole("link")).toHaveCount(6);
    await noHorizontalOverflow(page, "dashboard");
    expect(await smallTargets(page), "dashboard").toEqual([]);

    // création rapide d'un membre au clavier tactile
    await tabs.getByRole("link", { name: "Membres" }).tap();
    await expect(page).toHaveURL(/\/members$/);
    await page.getByRole("link", { name: "Ajouter un membre" }).tap();
    await page.getByLabel("Prénom").fill("Tactile");
    await page.getByRole("textbox", { name: "Nom", exact: true }).fill("Mobile");
    await page.getByLabel("Ce membre est").selectOption("adult");
    await page.getByLabel("Je confirme que ce membre est majeur.").tap();
    expect(await smallTargets(page), "nouveau membre").toEqual([]);
    await page.getByRole("button", { name: "Créer le membre" }).tap();
    await expect(page.getByRole("heading", { name: "Tactile Mobile" })).toBeVisible();
    await noHorizontalOverflow(page, "fiche membre");

    // planning
    await page.goto(`/a/${club}/schedule/new`);
    await page.getByLabel("Date de la première séance").fill(parisToday());
    await page.getByLabel("Heure de début").fill("18:00");
    expect(await smallTargets(page), "nouvelle séance").toEqual([]);
    await page.getByRole("button", { name: "Créer" }).tap();
    await expect(page.getByText("Création effectuée")).toBeVisible();
    await noHorizontalOverflow(page, "planning");
    expect(await smallTargets(page), "planning").toEqual([]);

    // appel : cibles tactiles et enregistrement
    await tabs.getByRole("link", { name: "Présences" }).tap();
    await expect(page).toHaveURL(/\/attendance$/);
    await page.getByRole("link", { name: "Faire l'appel" }).first().tap();
    const group = page.getByRole("group", { name: "Présence de Tactile Mobile" });
    await group.getByRole("button", { name: "En retard" }).tap();
    await expect(group.getByRole("button", { name: "En retard" })).toHaveAttribute("aria-pressed", "true");
    await noHorizontalOverflow(page, "feuille d'appel");
    expect(await smallTargets(page), "feuille d'appel").toEqual([]);

    // données persistantes après rechargement + navigation sur les autres pages
    await page.reload();
    await expect(group.getByRole("button", { name: "En retard" })).toHaveAttribute("aria-pressed", "true");
    for (const path of ["members", "reports", "settings", "dashboard"]) {
      await page.goto(`/a/${club}/${path}`);
      await noHorizontalOverflow(page, path);
    }
    expect(await smallTargets(page), "dashboard après données").toEqual([]);

    // déconnexion accessible depuis « Mon compte » (pas de barre latérale sur mobile)
    await page.getByRole("link", { name: "Mon compte" }).tap();
    await page.getByRole("button", { name: "Se déconnecter" }).tap();
    await expect(page).toHaveURL(/\/login/);
    await noHorizontalOverflow(page, "login");
    expect(await smallTargets(page), "connexion").toEqual([]);
    await logIn(page, email);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("adhérent : espace personnel et navigation à quatre onglets", async ({ browser }) => {
    const ctx = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR", timezoneId: "Europe/Paris" });
    const ownerCtx = await ctx();
    const owner = await ownerCtx.newPage();
    await ownerCtx.setExtraHTTPHeaders({ "x-real-ip": "10.9.9.1" });
    await signUp(owner, uniqueEmail("mob-proprio"), "Proprio");
    const club = await createClub(owner, "Club Adhérent");

    const memberCtx = await ctx();
    await memberCtx.setExtraHTTPHeaders({ "x-real-ip": "10.9.9.2" });
    const member = await memberCtx.newPage();
    const memberEmail = uniqueEmail("mob-membre");
    await signUp(member, memberEmail, "Adhérent");

    await owner.goto(`/a/${club}/settings`);
    const team = owner.getByRole("region", { name: "Équipe" });
    await team.getByLabel("E-mail").fill(memberEmail);
    await team.getByRole("combobox", { name: "Rôle", exact: true }).selectOption("member");
    await team.getByRole("button", { name: "Créer le lien d'invitation" }).click();
    const invite = new URL(await owner.getByLabel("Lien d'invitation").inputValue()).pathname;

    await member.goto(invite);
    expect(await smallTargets(member), "invitation").toEqual([]);
    await member.getByRole("button", { name: "Accepter l'invitation" }).tap();
    // La fiche est créée automatiquement ; tant que le profil n'est pas validé, « Mon espace » renvoie vers « Mon profil ».
    await expect(member).toHaveURL(new RegExp(`/a/${club}/profile`));
    await expect(member.getByRole("heading", { name: "Mon profil" })).toBeVisible();
    await noHorizontalOverflow(member, "profil");
    expect(await smallTargets(member), "profil").toEqual([]);
    await member.getByLabel("Ceinture").selectOption("blue");
    await member.getByLabel("Barrettes").selectOption("2");
    await member.getByLabel("Silhouette").selectOption("woman");
    await member.getByRole("textbox", { name: /^Nom/ }).fill("Adhérent");
    await member.getByLabel("Je confirme avoir 18 ans ou plus.").check();
    await member.getByRole("button", { name: "Valider mon profil" }).tap();
    await expect(member.getByText("Profil enregistré.")).toBeVisible();
    await member.goto(`/a/${club}/me`);
    await expect(member).toHaveURL(new RegExp(`/a/${club}/me`));
    const tabs = member.getByRole("navigation", { name: "Navigation principale" });
    await expect(tabs.getByRole("link")).toHaveCount(4);
    await expect(tabs.getByRole("link", { name: "Pointer ma présence" })).toBeVisible();
    await noHorizontalOverflow(member, "mon espace");
    expect(await smallTargets(member), "mon espace").toEqual([]);
    await tabs.getByRole("link", { name: "Planning" }).tap();
    await expect(member).toHaveURL(/\/schedule/);
    await noHorizontalOverflow(member, "planning membre");
    await tabs.getByRole("link", { name: "Classement" }).tap();
    await expect(member).toHaveURL(/\/ranking/);
    await expect(member.getByText("Mon rang")).toBeVisible();
    await noHorizontalOverflow(member, "classement membre");
    expect(await smallTargets(member), "classement membre").toEqual([]);
    await member.getByRole("button", { name: "Apparaître dans le classement" }).tap();
    await expect(member.getByRole("button", { name: "Me retirer du classement des autres" })).toBeVisible();
    await ownerCtx.close();
    await memberCtx.close();
  });

  test("les champs de saisie ne déclenchent pas de zoom iOS (police ≥ 16 px)", async ({ page }) => {
    await signUp(page, uniqueEmail("zoom"), "Zoom");
    const club = await createClub(page, "Club Zoom");
    for (const path of ["members", "reports", "attendance"]) {
      await page.goto(`/a/${club}/${path}`);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea")]
          .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => el.getAttribute("name") || el.id),
      );
      expect(small, path).toEqual([]);
    }
  });
});
