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
};
const portArg = process.argv.indexOf("--port");
if (portArg > 0 && process.argv[portArg + 1]) defaults.PORT = process.argv[portArg + 1]!;
for (const [k, v] of Object.entries(defaults)) process.env[k] ??= v;
console.log(`dev database ${name} ready; starting API on http://localhost:${process.env.PORT}`);
await import("../src/server.ts");
