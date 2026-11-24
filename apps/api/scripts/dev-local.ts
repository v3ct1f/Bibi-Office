/**
 * Local dev API without Docker/.env: prepares a persistent `office_dev` database (create if missing,
 * migrate, install built-in modules), fills in dev-only defaults, then starts the API.
 * Pair with `pnpm dev:oidc` and `pnpm dev:web`. Postgres owner URL: DEV_DATABASE_URL
 * (default postgres://office_owner:office_owner@localhost:55432/postgres, as scripts/local-pg.sh).
 *
 *   pnpm --filter @office/api dev:local
 *
 * Dev keys below are public and fixed: NEVER use this outside local development.
 */
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { migrate } from "@office/db";
import { installModules } from "@office/platform";
import { createRegistry } from "@office/modules";

if (process.env.NODE_ENV === "production") {
  console.error("dev-local refuses to run with NODE_ENV=production");
  process.exit(1);
}

const admin = process.env.DEV_DATABASE_URL ?? "postgres://office_owner:office_owner@localhost:55432/postgres";
const name = process.env.DEV_DB_NAME ?? "office_dev";
const sql = postgres(admin, { max: 1, onnotice: () => {} });
const [exists] = await sql`select 1 from pg_database where datname = ${name}`;
if (!exists) await sql.unsafe(`create database ${name}`);
await sql.end();

const owner = new URL(admin); owner.pathname = `/${name}`;
await migrate(owner.toString(), undefined, () => {});
await installModules(owner.toString(), createRegistry(), () => {});
const app = new URL(owner); app.username = "office_app"; app.password = "office_app";

const defaults: Record<string, string> = {
  NODE_ENV: "development",
  PORT: "3000",
  HOST: "127.0.0.1",
  DATABASE_URL_APP: app.toString(),
  OIDC_ISSUER: "http://localhost:8081/realms/office",
  OIDC_AUDIENCE: "office-api",
  API_KEY_PEPPER: "dev-pepper-dev-pepper-dev-pepper-000",
  SECRETS_KEY: Buffer.alloc(32, 1).toString("base64"),
  CORS_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173",
  // Locally, the default dev user is the program owner, and businesses are created from the admin page.
  PLATFORM_ADMIN_EMAILS: "dev@example.com",
  SELF_SIGNUP: "false",
  // Without Stripe keys, "Continue to payment" opens a demo checkout page (nothing is charged). Set TEST_PAYMENTS=false in
  // .env.local to turn it off. With real STRIPE_* keys in .env.local, Stripe is used and the demo is off.
  TEST_PAYMENTS: "true",
  // The local sign-in server (dev-oidc) hands out "set your password" links for emails.
  IDP_ADMIN_URL: "http://localhost:8081/dev-admin",
  IDP_ADMIN_SECRET: "dev-idp-admin-secret",
};
// Your own email settings for local testing live in the repo's .env.local (git-ignored, never committed).
// Only the mail and Stripe (paid sign-up, test keys) settings are read from it, so other settings there can't change the dev setup.
const localEnv = new URL("../../../.env.local", import.meta.url);
if (existsSync(localEnv)) {
  const vars = parseEnv(readFileSync(localEnv, "utf8"));
  for (const k of ["MAIL_SMTP_URL", "MAIL_FROM", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID", "STRIPE_PRICE_LABEL", "CONTACT_EMAIL", "TEST_PAYMENTS"]) if (vars[k]) process.env[k] ??= vars[k];
  if (process.env.MAIL_SMTP_URL) console.log(`email: invitations are sent from ${process.env.MAIL_FROM ?? "(MAIL_FROM missing)"}`);
}
const portArg = process.argv.indexOf("--port");
if (portArg > 0 && process.argv[portArg + 1]) defaults.PORT = process.argv[portArg + 1]!;
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
// --fake-ai: AI summaries answer from a local stand-in for the Anthropic API (no key or credit needed).
if (process.argv.includes("--fake-ai")) {
  const { startFakeClaude } = await import("../../../modules/ai/tests/fake-claude.ts");
  process.env.AI_API_BASE_URL = (await startFakeClaude()).url;
  console.log(`AI summaries use a fake Claude at ${process.env.AI_API_BASE_URL} (any API key works)`);
}
console.log(`dev database ${name} ready; starting API on http://localhost:${process.env.PORT}`);
await import("../src/server.ts");
