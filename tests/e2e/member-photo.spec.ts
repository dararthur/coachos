import sharp from "sharp";
import { completeProfile, createClub, expect, signUp, test, uniqueEmail } from "./support/helpers";

test.describe("photo de profil", () => {
  test("ajout, affichage normalisé, accès protégé, retrait", async ({ browser, page }) => {
    // Image 600×400 : passe par le recadrage du navigateur puis la normalisation du serveur.
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#c2410c" } }).png().toBuffer();
    await signUp(page, uniqueEmail("coach-photo"), "Coach Photo");
    const club = await createClub(page, "Club Photo");
    await page.goto(`/a/${club}/settings#inscription`);
    const code = (await page.getByTestId("join-code").innerText()).replace("-", "");

    const context = await browser.newContext({ locale: "fr-FR" });
    const member = await context.newPage();
    await signUp(member, uniqueEmail("photo"), "Marie Photo");
    await member.goto("/join");
    await member.getByLabel("Code du club").fill(code);
    await member.getByRole("button", { name: "Rejoindre" }).click();
    await completeProfile(member, club);

    await member.goto(`/a/${club}/profile`);
    await expect(member.locator('img[src*="/photo/"]')).toHaveCount(0);
    await member.waitForLoadState("networkidle");
    await member.getByLabel("Ajouter une photo").setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png });
    await expect(member.getByText("Photo enregistrée.")).toBeVisible();
    const img = member.locator('img[src*="/photo/"]');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBe(256);

    // Servie en WebP, derrière la session : un visiteur sans compte reçoit 404.
    const src = (await img.getAttribute("src"))!.split("?")[0]!;
    const own = await member.request.get(src);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("image/webp");
    const anon = await (await browser.newContext()).request.get(new URL(src, member.url()).toString());
    expect(anon.status()).toBe(404);

    await member.getByRole("button", { name: "Retirer la photo" }).click();
    await expect(member.getByText("Ajouter une photo")).toBeVisible();
    await expect(member.locator('img[src*="/photo/"]')).toHaveCount(0);
  });
});
