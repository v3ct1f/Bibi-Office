import { defineConfig, devices } from "@playwright/test";

/**
 * Full-stack E2E: real API + real Postgres + dev OIDC + Vite. Needs a Postgres owner URL
 * (scripts/local-pg.sh start, or CI service): E2E_DATABASE_URL=postgres://office_owner:office_owner@localhost:55432/postgres
 * Ports are offset from the dev defaults so E2E can run next to `pnpm dev:*`.
 */
const PG = process.env.E2E_DATABASE_URL ?? "postgres://office_owner:office_owner@localhost:55432/postgres";
const appDb = (() => { const u = new URL(PG); u.username = "office_app"; u.password = "office_app"; u.pathname = "/office_e2e"; return u.toString(); })();
const WEB = 5183, API = 3103, OIDC = 8093;
const issuer = `http://localhost:${OIDC}/realms/office`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: `http://localhost:${WEB}`, trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @office/api dev:oidc",
      url: `${issuer}/.well-known/openid-configuration`,
      env: { DEV_OIDC_PORT: String(OIDC), DEV_OIDC_REDIRECTS: `http://localhost:${WEB}/` },
      reuseExistingServer: false,
    },
    {
      command: `tsx e2e/prepare-db.ts && pnpm --filter @office/api exec tsx src/server.ts`,
      url: `http://localhost:${API}/healthz`,
      env: {
        E2E_DATABASE_URL: PG, NODE_ENV: "development", PORT: String(API), HOST: "127.0.0.1",
        DATABASE_URL_APP: appDb, OIDC_ISSUER: issuer, OIDC_AUDIENCE: "office-api",
        API_KEY_PEPPER: "e2e-pepper-e2e-pepper-e2e-pepper-0000", SECRETS_KEY: Buffer.alloc(32, 9).toString("base64"),
        CORS_ORIGINS: `http://localhost:${WEB}`, RATE_LIMIT_PER_MIN: "100000",
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `vite --port ${WEB} --strictPort`,
      url: `http://localhost:${WEB}`,
      env: { VITE_API_URL: `http://localhost:${API}`, VITE_OIDC_ISSUER: issuer, VITE_OIDC_CLIENT_ID: "office-web" },
      reuseExistingServer: false,
    },
  ],
});
