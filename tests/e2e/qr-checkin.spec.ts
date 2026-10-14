import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { completeProfile, createClub, expect, logIn, parisToday, PASSWORD, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

/** Heure locale Paris (HH:MM) actuelle : la séance de test couvre « maintenant ». */
const parisNow = (offsetMin = 0) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Date.now() + offsetMin * 60_000));

interface Actor {
  context: BrowserContext;
  page: Page;
  email: string;
}

const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR", timezoneId: "Europe/Paris" } as const;

async function newActor(browser: Browser, label: string, mobile = false): Promise<Actor> {
  const context = await browser.newContext({ ...(mobile ? MOBILE : { locale: "fr-FR", timezoneId: "Europe/Paris" }), extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const page = await context.newPage();
  const email = uniqueEmail(label);
  await signUp(page, email, label);
  return { context, page, email };
}

/** Club, séance couvrant l'instant présent, deux adhérents rattachés à leur fiche, un 3e adhérent sans compte. */
async function setup(browser: Browser) {
  const coach = await newActor(browser, "coach-qr");
  const club = await createClub(coach.page, "Club QR");

  const people: Record<string, string> = {};
  for (const [first, last] of [["Alice", "Pointe"], ["Bob", "Pointe"], ["Cara", "Sanscompte"]] as const) {
    await coach.page.goto(`/a/${club}/members/new`);
    await coach.page.getByLabel("Prénom").fill(first);
    await coach.page.getByRole("textbox", { name: "Nom", exact: true }).fill(last);
    await coach.page.getByLabel("Je confirme que ce membre est majeur.").check();
    await coach.page.getByRole("button", { name: "Créer le membre" }).click();
    await expect(coach.page.getByRole("heading", { name: `${first} ${last}` })).toBeVisible();
    people[first] = `${last} ${first}`;
  }

  await coach.page.goto(`/a/${club}/schedule/new`);
  await coach.page.getByLabel("Date de la première séance").fill(parisToday());
  await coach.page.getByLabel("Heure de début").fill(parisNow(-5));
  await coach.page.getByRole("button", { name: "Créer" }).click();
  await expect(coach.page.getByText("Création effectuée : 1")).toBeVisible();

  const join = async (first: "Alice" | "Bob") => {
    const member = await newActor(browser, first.toLowerCase(), true);
    await coach.page.goto(`/a/${club}/settings`);
    const team = coach.page.getByRole("region", { name: "Équipe" });
    await team.getByLabel("E-mail").fill(member.email);
    await team.getByRole("combobox", { name: "Rôle", exact: true }).selectOption("member");
    await team.getByRole("combobox", { name: "Fiche membre liée" }).selectOption({ label: people[first]! });
    await team.getByRole("button", { name: "Créer le lien d'invitation" }).click();
    const invite = new URL(await coach.page.getByLabel("Lien d'invitation").inputValue()).pathname;
    await member.page.goto(invite);
    await member.page.getByRole("button", { name: "Accepter l'invitation" }).tap();
    await completeProfile(member.page, club);
    return member;
  };
  const alice = await join("Alice");
  const bob = await join("Bob");

  await coach.page.goto(`/a/${club}/attendance`);
  await coach.page.getByRole("link", { name: "Faire l'appel" }).first().click();
  await expect(coach.page.getByRole("heading", { name: "Pointage par QR code" })).toBeVisible();
  return { coach, club, alice, bob, rollUrl: coach.page.url() };
}

/** Ouvre le pointage et retourne le lien courant du QR (affiché dans « Lien de pointage »). */
async function openAndGetLink(coach: Page): Promise<string> {
  await coach.getByRole("button", { name: "Ouvrir le pointage" }).click();
  await expect(coach.getByRole("img", { name: "QR code de pointage pour cette séance" })).toBeVisible();
  return currentLink(coach);
}

async function currentLink(coach: Page): Promise<string> {
  await coach.locator("details").evaluate((el) => ((el as HTMLDetailsElement).open = true));
  return coach.getByLabel("Valable quelques secondes", { exact: false }).inputValue();
}

const rowFor = (page: Page, name: string) => page.getByRole("group", { name: `Présence de ${name}` });

test.describe("pointage par QR code", () => {
  test("parcours complet : ouverture, scan par l'adhérent, liste du coach, correction, validation", async ({ browser }) => {
    test.setTimeout(180_000);
    const { coach, alice, bob } = await setup(browser);
    const c = coach.page;

    await test.step("le coach ouvre le pointage : QR, compte à rebours, aucun identifiant dans le lien", async () => {
      const link = await openAndGetLink(c);
      expect(link).toMatch(/\/checkin\/[A-Za-z0-9_-]{43}$/);
      expect(new URL(link).search).toBe("");
      await expect(c.getByTestId("qr-countdown")).toContainText(/valide encore \d+ s/);
      await expect(c.getByRole("progressbar", { name: "Validité du QR code" })).toBeVisible();
      await expect(c.getByText("Le pointage est fermé")).toHaveCount(0);

      // accessibilité (WCAG AA) de la feuille avec QR ouvert
      const axe = await new AxeBuilder({ page: c }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);

      // mobile : le QR et ses informations tiennent dans l'écran, sans défilement horizontal
      await c.setViewportSize({ width: 390, height: 844 });
      expect(await c.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const qr = await c.getByRole("img", { name: "QR code de pointage pour cette séance" }).boundingBox();
      expect(qr!.width).toBeGreaterThan(200); // assez grand pour être scanné
      expect(qr!.x + qr!.width).toBeLessThanOrEqual(390);
      await c.setViewportSize({ width: 1280, height: 720 });
    });

    let aliceLink = "";
    await test.step("Alice ouvre le lien : aperçu sans effet, puis confirmation explicite", async () => {
      aliceLink = await currentLink(c);
      await alice.page.goto(new URL(aliceLink).pathname);
      await expect(alice.page.getByText("JJB — Tous niveaux")).toBeVisible();
      await expect(c.getByText("Pointé par QR", { exact: true })).toHaveCount(0); // l'ouverture du lien n'a rien enregistré
      await expect(rowFor(c, "Alice Pointe").getByRole("button", { name: "Présent", exact: true })).toHaveAttribute("aria-pressed", "false");
      await alice.page.getByRole("button", { name: "Confirmer ma présence" }).tap();
      await expect(alice.page.getByTestId("checkin-success")).toContainText("Présence enregistrée pour « JJB — Tous niveaux »");
    });

    await test.step("la liste du coach se met à jour d'elle-même, avec l'origine QR", async () => {
      await expect(rowFor(c, "Alice Pointe").getByRole("button", { name: "Présent", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
      await expect(c.getByText("Pointé par QR", { exact: true })).toHaveCount(1);
      await expect(c.getByText(/1\s+adhérent pointé par QR/)).toBeVisible();
    });

    await test.step("double scan : réponse honnête, aucun doublon", async () => {
      await alice.page.goto(new URL(await currentLink(c)).pathname);
      await expect(alice.page.getByTestId("checkin-success")).toContainText("déjà enregistrée");
      await expect(c.getByText("Pointé par QR", { exact: true })).toHaveCount(1);
    });

    await test.step("Bob pointe aussi ; le coach corrige Alice : la correction n'est pas écrasée par un nouveau scan", async () => {
      await bob.page.goto(new URL(await currentLink(c)).pathname);
      await bob.page.getByRole("button", { name: "Confirmer ma présence" }).tap();
      await expect(bob.page.getByTestId("checkin-success")).toBeVisible();
      await expect(c.getByText("Pointé par QR", { exact: true })).toHaveCount(2, { timeout: 15_000 });

      await rowFor(c, "Alice Pointe").getByRole("button", { name: "Absent" }).click();
      await expect(rowFor(c, "Alice Pointe").getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
      await expect(c.getByText("Pointé par QR", { exact: true })).toHaveCount(1); // Alice repasse en « manuel »
      await alice.page.goto(new URL(await currentLink(c)).pathname);
      await expect(alice.page.getByTestId("checkin-success")).toContainText("déjà enregistrée");
      await expect(alice.page.getByTestId("checkin-success")).toContainText("absent");
      await expect(rowFor(c, "Alice Pointe").getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("ajout manuel d'un adhérent sans compte", async () => {
      await rowFor(c, "Cara Sanscompte").getByRole("button", { name: "En retard" }).click();
      await expect(rowFor(c, "Cara Sanscompte").getByRole("button", { name: "En retard" })).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("validation de la feuille : le pointage se ferme, les anciens liens meurent, la feuille se rouvre", async () => {
      const lastLink = await currentLink(c);
      await c.getByRole("button", { name: "Valider la feuille d'appel" }).click();
      await c.getByRole("dialog", { name: "Valider la feuille d'appel ?" }).getByRole("button", { name: "Valider la feuille" }).click();
      await expect(c.getByText("Feuille validée", { exact: true })).toBeVisible();
      await expect(c.getByRole("img", { name: "QR code de pointage pour cette séance" })).toHaveCount(0);

      const late = await newActor(browser, "tardif", true);
      await late.page.goto(new URL(lastLink).pathname);
      await expect(late.page.getByText("QR code invalide ou expiré")).toBeVisible();
      await late.context.close();

      await c.getByRole("button", { name: "Rouvrir la feuille" }).click();
      await expect(c.getByRole("button", { name: "Ouvrir le pointage" })).toBeVisible();
      await c.reload();
      await expect(rowFor(c, "Cara Sanscompte").getByRole("button", { name: "En retard" })).toHaveAttribute("aria-pressed", "true"); // persistance
      await expect(rowFor(c, "Bob Pointe").getByRole("button", { name: "Présent", exact: true })).toHaveAttribute("aria-pressed", "true");
    });

    for (const a of [coach, alice, bob]) await a.context.close();
  });

  test("jeton expiré, pointage fermé, utilisateur non connecté, autre club, jeton inventé", async ({ browser }) => {
    test.setTimeout(180_000);
    const { coach, alice, bob } = await setup(browser);
    const c = coach.page;
    const link = await openAndGetLink(c);
    const path = new URL(link).pathname;

    await test.step("expiré (durée de vie 10 s dans cet environnement de test)", async () => {
      await alice.page.waitForTimeout(11_500);
      await alice.page.goto(path);
      await expect(alice.page.getByText("QR code invalide ou expiré")).toBeVisible();
      await expect(alice.page.getByRole("button", { name: "Confirmer ma présence" })).toHaveCount(0);
      await expect(alice.page.getByRole("link", { name: "Scanner à nouveau" })).toBeVisible();
    });

    await test.step("le QR courant fonctionne ; une fois le pointage fermé, il est révoqué aussitôt", async () => {
      const fresh = new URL(await currentLink(c)).pathname;
      await c.getByRole("button", { name: "Fermer le pointage" }).click();
      await expect(c.getByRole("button", { name: "Ouvrir le pointage" })).toBeVisible();
      await bob.page.goto(fresh);
      await expect(bob.page.getByText("QR code invalide ou expiré")).toBeVisible();
      await expect(c.getByText("Pointé par QR", { exact: true })).toHaveCount(0);
    });

    await test.step("non connecté : redirection vers la connexion, puis retour au pointage", async () => {
      await c.getByRole("button", { name: "Ouvrir le pointage" }).click();
      const livePath = new URL(await currentLink(c)).pathname;
      const anonymous = await browser.newContext({ ...MOBILE, extraHTTPHeaders: { "x-real-ip": randomIp() } });
      const page = await anonymous.newPage();
      await page.goto(livePath);
      await expect(page).toHaveURL(/\/login\?next=%2Fcheckin%2F/);
      await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
      await logIn(page, bob.email, livePath);
      await expect(page).toHaveURL(new RegExp(livePath));
      await page.getByRole("button", { name: "Confirmer ma présence" }).tap();
      await expect(page.getByTestId("checkin-success")).toBeVisible();
      await anonymous.close();
    });

    await test.step("adhérent d'un autre club ou compte sans club : message identique à un jeton inventé", async () => {
      const outsider = await newActor(browser, "autre-club", true);
      await outsider.page.getByLabel("Nom du club").fill("Autre club");
      await outsider.page.getByRole("button", { name: "Créer le club" }).click();
      await expect(outsider.page).toHaveURL(/\/dashboard/);
      const livePath = new URL(await currentLink(c)).pathname;
      await outsider.page.goto(livePath);
      const foreign = await outsider.page.getByRole("alert").filter({ hasText: "QR code invalide" }).innerText();
      await outsider.page.goto(`/checkin/${randomBytes(32).toString("base64url")}`);
      const invented = await outsider.page.getByRole("alert").filter({ hasText: "QR code invalide" }).innerText();
      expect(foreign).toBe(invented);
      expect(foreign).toContain("QR code invalide ou expiré");
      await outsider.page.goto("/checkin/pas-un-jeton");
      expect(await outsider.page.getByRole("alert").filter({ hasText: "QR code invalide" }).innerText()).toBe(invented);
      await outsider.context.close();
    });

    await test.step("limitation de débit : les essais répétés de jetons inventés sont bloqués", async () => {
      const prober = await newActor(browser, "sonde", true);
      let limited = false;
      for (let i = 0; i < 60 && !limited; i++) {
        await prober.page.goto(`/checkin/${randomBytes(32).toString("base64url")}`);
        limited = await prober.page.getByText("Trop de tentatives").isVisible();
      }
      expect(limited).toBe(true);
      await prober.context.close();
    });

    for (const a of [coach, alice, bob]) await a.context.close();
  });

  test("feuille d'appel cohérente après une erreur réseau ou une réponse perdue, et nouvelle tentative", async ({ browser }) => {
    test.setTimeout(180_000);
    const { coach, rollUrl } = await setup(browser);
    const c = coach.page;
    const alice = rowFor(c, "Alice Pointe").getByRole("button", { name: "Présent", exact: true });
    const bob = rowFor(c, "Bob Pointe").getByRole("button", { name: "Présent", exact: true });

    await test.step("requête perdue avant le serveur : rien d'affiché comme enregistré, retry OK", async () => {
      await c.route(rollUrl, (route) => (route.request().method() === "POST" ? route.abort("connectionreset") : route.continue()));
      await alice.click();
      await expect(c.getByText(/Connexion perdue/).first()).toBeVisible();
      await expect(alice).toHaveAttribute("aria-pressed", "false");
      await expect(c.getByTestId("sync-lost")).toBeVisible({ timeout: 15_000 }); // l'actualisation le signale aussi
      await c.unroute(rollUrl);
      await expect(c.getByTestId("sync-lost")).toHaveCount(0, { timeout: 15_000 }); // reprise automatique
      await alice.click();
      await expect(alice).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("réponse perdue APRÈS écriture : la relecture montre la vérité, le retry ne crée aucun doublon", async () => {
      let first = true;
      await c.route(rollUrl, async (route) => {
        if (route.request().method() !== "POST" || !first) return route.continue();
        first = false;
        await route.fetch(); // le serveur traite et écrit…
        await route.abort("connectionreset"); // …mais le navigateur ne reçoit jamais la réponse
      });
      await bob.click();
      await expect(c.getByText(/Connexion perdue/).first()).toBeVisible();
      await expect(bob).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 }); // état relu depuis la base, pas supposé
      await c.unroute(rollUrl);
      await bob.click(); // un second clic efface (bascule) : on vérifie l'état réel, pas un compteur local
      await expect(bob).toHaveAttribute("aria-pressed", "false");
      await bob.click();
      await expect(bob).toHaveAttribute("aria-pressed", "true");
    });

    await test.step("rechargement : la base contient exactement ce que l'écran affichait", async () => {
      await c.reload();
      await expect(alice).toHaveAttribute("aria-pressed", "true");
      await expect(bob).toHaveAttribute("aria-pressed", "true");
      await expect(c.getByText(/2 présents/)).toBeVisible();
    });

    await coach.context.close();
  });
});

test.describe("scanner côté adhérent (mobile)", () => {
  test("la caméra n'est demandée qu'après un clic ; sans caméra ou sans autorisation, alternative sécurisée", async ({ browser }) => {
    const m = await newActor(browser, "sans-camera", true);
    await m.page.addInitScript(() => {
      const w = window as unknown as { __gum: number };
      w.__gum = 0;
      const md = navigator.mediaDevices;
      if (md) {
        const orig = md.getUserMedia.bind(md);
        md.getUserMedia = (...a: Parameters<typeof orig>) => {
          w.__gum++;
          return orig(...a);
        };
      }
    });
    await m.page.getByLabel("Nom du club").fill("Club Scan");
    await m.page.getByRole("button", { name: "Créer le club" }).click();
    await expect(m.page).toHaveURL(/dashboard/);

    await m.page.goto("/checkin");
    await expect(m.page.getByRole("heading", { name: "Pointer ma présence" })).toBeVisible();
    expect(await m.page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0); // aucune sollicitation avant action explicite
    await expect(m.page.getByRole("button", { name: "Scanner un QR code" })).toBeVisible();

    await m.context.clearPermissions();
    await m.page.getByRole("button", { name: "Scanner un QR code" }).tap();
    expect(await m.page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(1);
    const problem = m.page.getByTestId("camera-problem");
    await expect(problem).toBeVisible(); // pas de caméra / permission refusée en environnement de test
    expect(["denied", "unavailable", "error"]).toContain(await problem.getAttribute("data-phase"));
    await expect(m.page.getByRole("button", { name: "Réessayer la caméra" })).toBeVisible();

    // Repli : le coach marque présent à l'appel ; le lien de pointage reste possible, replié.
    await expect(m.page.getByText("il vous marque présent à l'appel")).toBeVisible();
    await m.page.getByText("J'ai un lien de pointage").tap();
    const manual = m.page.getByLabel("Lien ou code de pointage");
    await manual.fill("https://evil.example/checkin/" + randomBytes(32).toString("base64url"));
    await m.page.getByRole("button", { name: "Continuer" }).tap();
    await expect(m.page.getByText("Lien ou code non reconnu")).toBeVisible();
    await expect(m.page).toHaveURL(/\/checkin$/); // jamais de navigation vers un domaine étranger
    await manual.fill(`${new URL(m.page.url()).origin}/checkin/${randomBytes(32).toString("base64url")}`);
    await m.page.getByRole("button", { name: "Continuer" }).tap();
    await expect(m.page).toHaveURL(/\/checkin\/[A-Za-z0-9_-]{43}$/);
    await expect(m.page.getByText("QR code invalide ou expiré")).toBeVisible();

    // ergonomie : pas de débordement, cibles tactiles suffisantes
    await m.page.goto("/checkin");
    expect(await m.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const small = await m.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main button, main input:not([type=hidden]), main a")]
        .filter((el) => el.getBoundingClientRect().height < 43.5 && el.getBoundingClientRect().width > 0)
        .map((el) => (el.textContent || el.getAttribute("name") || "").trim().slice(0, 30)),
    );
    expect(small).toEqual([]);

    // en-têtes : la caméra n'est autorisée que sur /checkin
    const scanHeaders = (await m.page.goto("/checkin"))!.headers();
    expect(scanHeaders["permissions-policy"]).toContain("camera=(self)");
    expect(scanHeaders["permissions-policy"]).toContain("geolocation=()");
    expect((await m.page.goto("/academies"))!.headers()["permissions-policy"]).toContain("camera=()");
    await m.context.close();
  });
});

test("authentification : un identifiant forgé dans l'URL du pointage ne change rien (l'identité vient de la session)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { coach, alice, bob } = await setup(browser);
  const link = await openAndGetLink(coach.page);
  // Bob tente d'ajouter des paramètres désignant Alice : ignorés, seul Bob est pointé.
  const forged = `${new URL(link).pathname}?person=alice&user=${encodeURIComponent(alice.email)}`;
  await bob.page.goto(forged);
  await bob.page.getByRole("button", { name: "Confirmer ma présence" }).tap();
  await expect(bob.page.getByTestId("checkin-success")).toBeVisible();
  await expect(rowFor(coach.page, "Bob Pointe").getByRole("button", { name: "Présent", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
  await expect(rowFor(coach.page, "Alice Pointe").getByRole("button", { name: "Présent", exact: true })).toHaveAttribute("aria-pressed", "false");
  void PASSWORD;
  for (const a of [coach, alice, bob]) await a.context.close();
});
