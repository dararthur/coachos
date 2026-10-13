import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);

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
    // En local, utiliser Chrome/Edge déjà installés (PW_CHANNEL=chrome|msedge) ; en CI, Chromium de Playwright.
    ...devices["Desktop Chrome"],
    channel: process.env.PW_CHANNEL || undefined,
  },
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
