import { createClub, expect, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

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
  await expect(page.getByText("Cadrez le QR code affiché par le coach.")).toBeVisible();
  await expect(page.getByLabel("Aperçu de la caméra")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (document.querySelector("video")?.srcObject as MediaStream | null)?.active ?? false)).toBe(true);
  await page.waitForTimeout(1500); // le motif de test ne contient aucun QR : aucune navigation
  await expect(page).toHaveURL(/\/checkin$/);
  await page.getByRole("button", { name: "Arrêter la caméra" }).tap();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.srcObject ?? null)).toBeNull();
  await expect(page.getByRole("button", { name: "Scanner un QR code" })).toBeVisible();
  await context.close();
});
