import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);

/**
 * Parcours rejoués aussi dans les moteurs de Safari (WebKit) et de Firefox : caméra et QR, mise en page, mobile, accessibilité.
 * WebKit de Playwright n'est PAS Safari iOS (ni le même système, ni la même caméra, ni les mêmes réglages) : voir docs/qr-checkin.md.
 */
const ENGINE_SPECS = [/qr-camera\.spec\.ts$/, /qr-real-decode\.spec\.ts$/, /responsive\.spec\.ts$/, /mobile-pwa\.spec\.ts$/, /accessibility\.spec\.ts$/];

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // En local, utiliser Chrome/Edge déjà installés (PW_CHANNEL=chrome|msedge) ; en CI, Chromium de Playwright.
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined },
    },
    {
      name: "webkit",
      testMatch: ENGINE_SPECS,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox",
      testMatch: ENGINE_SPECS,
      // Caméra simulée : réglée par les tests qui en ont besoin, selon le moteur (tests/e2e/support/camera.ts).
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    // Nécessite un `next build` préalable (npm run test:e2e s'en charge).
    command: "node tests/e2e/support/run-stack.mjs",
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
