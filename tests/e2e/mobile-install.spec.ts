import { createClub, expect, randomIp, signUp, test, uniqueEmail } from "./support/helpers";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

test.describe("application installable et session longue", () => {
  test("la session dure un an (cookie persistant) et le manifeste propose le raccourci de pointage", async ({ page, context }) => {
    await signUp(page, uniqueEmail("longue"), "Session Longue");
    const cookies = await context.cookies();
    const session = cookies.find((c) => /session_token/.test(c.name));
    expect(session, "cookie de session").toBeTruthy();
    const days = (session!.expires - Date.now() / 1000) / 86_400;
    expect(days).toBeGreaterThan(300);

    const manifest = await (await page.request.get("/manifest.webmanifest")).json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.shortcuts?.[0]?.url).toBe("/checkin?scan=1");
  });

  test("sur iPhone, un bandeau explique l'installation ; il se ferme et ne revient pas", async ({ browser }) => {
    const context = await browser.newContext({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, extraHTTPHeaders: { "x-real-ip": randomIp() } });
    const page = await context.newPage();
    await signUp(page, uniqueEmail("iphone"), "Coach iPhone");
    await createClub(page, "Club Mobile");
    const banner = page.getByRole("complementary", { name: "Installer l'application" });
    await expect(banner).toContainText("Sur l'écran d'accueil");
    await banner.getByRole("button", { name: "Masquer ce message" }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByRole("complementary", { name: "Installer l'application" })).toHaveCount(0);

    // « Mon compte » garde le mode d'emploi en permanence.
    await page.goto("/account");
    await expect(page.getByText("« Sur l'écran d'accueil »")).toBeVisible();
    await context.close();
  });
});
