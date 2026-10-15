import { completeProfile, createClub, expect, PASSWORD, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

// Caméra SIMULÉE par Chrome (motif de test, sans QR) : vérifie le démarrage, l'aperçu et l'arrêt du flux.
test.use({ launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } });
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: "fr-FR", timezoneId: "Europe/Paris" } as const;

test("la caméra démarre après le clic, affiche l'aperçu et s'éteint à l'arrêt ; un QR étranger ne mène nulle part", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, permissions: ["camera"], extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const page = await context.newPage();
  await signUp(page, uniqueEmail("cam"), "Cam");
  await createClub(page, "Club Cam");
  await page.goto("/checkin");
  await page.getByRole("button", { name: "Scanner un QR code" }).tap();
  await expect(page.getByText("Cadrez le QR code de l'affiche ou de l'écran du coach.")).toBeVisible();
  await expect(page.getByLabel("Aperçu de la caméra")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.querySelector("video")?.srcObject as MediaStream | null)?.active ?? false)).toBe(true);
  await page.waitForTimeout(1500); // le motif de test ne contient aucun QR : aucune navigation
  await expect(page).toHaveURL(/\/checkin$/);
  await page.getByRole("button", { name: "Arrêter la caméra" }).tap();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.srcObject ?? null)).toBeNull();
  await expect(page.getByRole("button", { name: "Scanner un QR code" })).toBeVisible();
  await context.close();
});

test("ouverte depuis « Pointer ma présence » (?scan=1), la caméra démarre sans second appui", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, permissions: ["camera"], extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const page = await context.newPage();
  await signUp(page, uniqueEmail("cam-auto"), "Cam Auto");
  await createClub(page, "Club Cam Auto");
  await page.goto("/checkin?scan=1");
  await expect(page.getByLabel("Aperçu de la caméra")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.querySelector("video")?.srcObject as MediaStream | null)?.active ?? false)).toBe(true);
  await expect(page.getByRole("button", { name: "Scanner un QR code" })).toHaveCount(0);
  await page.getByRole("button", { name: "Arrêter la caméra" }).tap();
  await context.close();
});

// Régression (Android/Chrome) : la Permissions-Policy est figée au CHARGEMENT du document. Arrivé sur /checkin par la navigation
// interne de l'application (onglet « Pointer », bouton « Pointer ma présence »), le document restait celui de la page précédente,
// servi avec `camera=()` : Chrome refusait la caméra (NotAllowedError) alors que le site était autorisé.
test("arrivée par la navigation interne (onglet « Pointer ») : la caméra démarre sans rechargement", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, permissions: ["camera"], extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const page = await context.newPage();
  await signUp(page, uniqueEmail("cam-nav"), "Cam Nav");
  const club = await createClub(page, "Club Cam Nav");
  await page.getByRole("button", { name: "Mode membre" }).click();
  await completeProfile(page, club);
  await page.evaluate(() => ((window as unknown as { __sameDocument: boolean }).__sameDocument = true));
  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Pointer ma présence" }).tap(); // onglet « Pointer »
  await expect(page).toHaveURL(/\/checkin\?scan=1$/);
  await expect.poll(() => page.evaluate(() => (document.querySelector("video")?.srcObject as MediaStream | null)?.active ?? false)).toBe(true);
  await expect(page.getByTestId("camera-problem")).toHaveCount(0);
  // Navigation côté client (même document) : c'est bien le cas qui échouait, pas un chargement complet de /checkin.
  expect(await page.evaluate(() => (window as unknown as { __sameDocument?: boolean }).__sameDocument)).toBe(true);
  await page.getByRole("button", { name: "Arrêter la caméra" }).tap();
  await context.close();
});

// Échecs de caméra SIMULÉS dans Chrome (getUserMedia et l'API Permissions remplacés) : prouve le comportement du scanner pour
// chaque cause, sous l'identité d'un Chrome Android. Ce n'est PAS un essai sur un téléphone physique.
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
type CamControl = { mode: string; perm: PermissionState; delay: number; calls: number; streams: MediaStream[] };

test("scanner : chaque échec de caméra a son message, et la caméra n'est jamais laissée allumée (Chrome, identité Android)", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...MOBILE, userAgent: ANDROID_UA, permissions: ["camera"], extraHTTPHeaders: { "x-real-ip": randomIp() } });
  await context.addInitScript(() => {
    const cam: CamControl = { mode: "ok", perm: "granted", delay: 0, calls: 0, streams: [] };
    (window as unknown as { __cam: CamControl }).__cam = cam;
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      cam.calls++;
      if (cam.delay) await new Promise((r) => setTimeout(r, cam.delay));
      if (cam.mode !== "ok") throw new DOMException("simulé", cam.mode);
      const s = await real(c);
      cam.streams.push(s);
      return s;
    };
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d: PermissionDescriptor) =>
      d.name === ("camera" as PermissionName) ? Promise.resolve({ state: cam.perm, addEventListener() {}, removeEventListener() {} } as unknown as PermissionStatus) : query(d);
  });
  const page = await context.newPage();
  await signUp(page, uniqueEmail("cam-fail"), "Cam Fail");
  await createClub(page, "Club Cam Fail");

  const set = (v: Partial<CamControl>) => page.evaluate((x) => Object.assign((window as unknown as { __cam: CamControl }).__cam, x), v);
  const cam = () => page.evaluate(() => {
    const c = (window as unknown as { __cam: CamControl }).__cam;
    return { calls: c.calls, live: c.streams.filter((s) => s.getTracks().some((t) => t.readyState === "live")).length };
  });
  const problem = page.getByTestId("camera-problem");
  const scanner = page.getByTestId("scanner");
  const open = async (v: Partial<CamControl>) => {
    await page.goto("/checkin");
    await set(v);
    await page.getByRole("button", { name: "Scanner un QR code" }).tap();
  };

  await test.step("refus enregistré pour le site : marche à suivre Android, y compris l'autorisation de Chrome", async () => {
    await open({ mode: "NotAllowedError", perm: "denied" });
    await expect(problem).toHaveAttribute("data-phase", "denied");
    await expect(problem).toContainText("Autorisations › Caméra");
    await expect(problem).toContainText("Applications › Chrome");
    await expect(page.getByRole("button", { name: "Réessayer la caméra" })).toBeVisible();
  });
  await test.step("fenêtre d'autorisation fermée : on propose simplement de réessayer", async () => {
    await open({ mode: "NotAllowedError", perm: "prompt" });
    await expect(problem).toHaveAttribute("data-phase", "dismissed");
    await expect(problem).not.toContainText("Autorisations › Caméra");
    await set({ mode: "ok", perm: "granted" });
    await page.getByRole("button", { name: "Réessayer la caméra" }).tap();
    await expect(scanner).toHaveAttribute("data-phase", "scanning");
    expect((await cam()).live).toBe(1);
  });
  await test.step("aucune caméra / caméra occupée / erreur inconnue", async () => {
    for (const [mode, phase] of [["NotFoundError", "unavailable"], ["NotReadableError", "busy"], ["TypeError", "error"]] as const) {
      await open({ mode, perm: "granted" });
      await expect(problem).toHaveAttribute("data-phase", phase);
    }
  });
  await test.step("API caméra absente (navigateur intégré d'une autre application)", async () => {
    await page.goto("/checkin");
    await page.evaluate(() => Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true }));
    await page.getByRole("button", { name: "Scanner un QR code" }).tap();
    await expect(problem).toHaveAttribute("data-phase", "unavailable");
    await expect(problem).toContainText("ouvrez-le dans Chrome ou Safari");
  });
  await test.step("arrêt pendant le démarrage : le flux obtenu ensuite est libéré aussitôt", async () => {
    await open({ mode: "ok", delay: 1500 });
    await expect(scanner).toHaveAttribute("data-phase", "starting");
    await page.getByRole("button", { name: "Arrêter la caméra" }).tap();
    await expect(scanner).toHaveAttribute("data-phase", "idle");
    await page.waitForTimeout(2000);
    expect(await cam()).toEqual({ calls: 1, live: 0 });
    await expect(scanner).toHaveAttribute("data-phase", "idle");
  });
  await test.step("double appui : une seule demande de caméra", async () => {
    await page.goto("/checkin");
    await set({ mode: "ok", delay: 800 });
    await page.getByRole("button", { name: "Scanner un QR code" }).evaluate((b: HTMLElement) => { b.click(); b.click(); }); // deux appuis dans la même image
    await expect(scanner).toHaveAttribute("data-phase", "scanning");
    expect(await cam()).toEqual({ calls: 1, live: 1 });
  });
  await test.step("flux interrompu (autre application) puis réouverture", async () => {
    await page.evaluate(() => {
      const t = (window as unknown as { __cam: CamControl }).__cam.streams[0]!.getVideoTracks()[0]!;
      t.stop();
      t.dispatchEvent(new Event("ended"));
    });
    await expect(problem).toHaveAttribute("data-phase", "interrupted");
    await page.getByRole("button", { name: "Réessayer la caméra" }).tap();
    await expect(scanner).toHaveAttribute("data-phase", "scanning");
    expect((await cam()).live).toBe(1);
  });
  await test.step("application en arrière-plan : caméra coupée, relancée au retour", async () => {
    const visibility = (state: "hidden" | "visible") =>
      page.evaluate((s) => {
        Object.defineProperty(document, "visibilityState", { value: s, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }, state);
    await visibility("hidden");
    await expect.poll(async () => (await cam()).live).toBe(0);
    await visibility("visible");
    await expect(scanner).toHaveAttribute("data-phase", "scanning");
    expect((await cam()).live).toBe(1);
  });
  await test.step("quitter la page pendant le scan éteint la caméra", async () => {
    await page.getByRole("link", { name: "Retour" }).tap();
    await expect(page).not.toHaveURL(/\/checkin/);
    await expect.poll(async () => (await cam().catch(() => ({ live: 0 }))).live).toBe(0);
  });
  await context.close();
});

test("raccourci « Pointer ma présence » ouvert hors connexion : après la connexion, retour direct au scanner", async ({ browser }) => {
  const context = await browser.newContext({ ...MOBILE, permissions: ["camera"], extraHTTPHeaders: { "x-real-ip": randomIp() } });
  const page = await context.newPage();
  const email = uniqueEmail("cam-login");
  await signUp(page, email, "Cam Login");
  await createClub(page, "Club Cam Login");
  await context.clearCookies();
  await page.goto("/checkin?scan=1");
  await expect(page).toHaveURL(/\/login\?next=%2Fcheckin%3Fscan%3D1$/);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/checkin\?scan=1$/);
  await expect.poll(() => page.evaluate(() => (document.querySelector("video")?.srcObject as MediaStream | null)?.active ?? false)).toBe(true);
  await context.close();
});
