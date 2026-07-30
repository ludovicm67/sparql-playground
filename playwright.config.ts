import { defineConfig, devices } from "@playwright/test";

const APP_PORT = 4173;
const MOCK_PORT = 4567;

export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // The app is a static export; nothing is shared between specs except the
  // servers, so files can run in parallel.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: APP_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Several specs check that a canvas or resource link lands somewhere; give
    // them a viewport wide enough for the three-panel layouts.
    viewport: { width: 1600, height: 950 },
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      // Serve the real static export, the artefact that actually ships.
      command: `npx serve out -p ${APP_PORT} --no-clipboard`,
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `node e2e/fixtures/mock-endpoint.mjs ${MOCK_PORT}`,
      url: `${MOCK_URL}/__log`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
