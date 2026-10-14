import sharp from "sharp";
import { createClub, expect, signUp, test, uniqueEmail } from "./support/helpers";

test("logo du club : ajout dans les paramètres, affiché dans la navigation, protégé, retrait", async ({ browser, page }) => {
  const png = await sharp({ create: { width: 800, height: 300, channels: 3, background: "#1d4e89" } }).png().toBuffer();
  await signUp(page, uniqueEmail("logo"), "Coach Logo");
  const club = await createClub(page, "Club Logo");
  await page.goto(`/a/${club}/settings#club`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Ajouter le logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Logo enregistré.")).toBeVisible();

  await page.goto(`/a/${club}/dashboard`);
  const logo = page.locator('aside img[src*="/logo"]');
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((e: HTMLImageElement) => [e.naturalWidth, e.naturalHeight])).toEqual([256, 96]);

  // Réservé aux membres du club.
  const anon = await (await browser.newContext()).request.get(new URL(`/a/${club}/logo`, page.url()).toString());
  expect(anon.status()).toBe(404);

  await page.goto(`/a/${club}/settings#club`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Retirer le logo" }).click();
  await expect(page.getByLabel("Ajouter le logo")).toBeAttached();
  await page.goto(`/a/${club}/dashboard`);
  await expect(page.locator('aside img[src*="/logo"]')).toHaveCount(0);
});
