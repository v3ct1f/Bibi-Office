import { defineConfig, devices } from "@playwright/test";

// Full-stack E2E: real API + real Postgres (TEST_DATABASE_URL) + locally signed OIDC tokens.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173", trace: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /(mobile|screenshots)\.spec\.ts/ },
    { name: "screens", use: { ...devices["Desktop Chrome"] }, testMatch: /screenshots\.spec\.ts/, dependencies: ["desktop"] },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/, dependencies: ["desktop"] },
  ],
});
