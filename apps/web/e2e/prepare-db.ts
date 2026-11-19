// Recreates the E2E database, runs core migrations and installs built-in modules.
// Used by playwright.config.ts before the API starts.
import postgres from "postgres";
import { migrate } from "@office/db";
import { installModules } from "@office/platform";
import { createRegistry } from "@office/modules";

const admin = process.env.E2E_DATABASE_URL ?? "postgres://office_owner:office_owner@localhost:55432/postgres";
const name = process.env.E2E_DB_NAME ?? "office_e2e";
const sql = postgres(admin, { max: 1, onnotice: () => {} });
await sql.unsafe(`drop database if exists ${name} with (force)`);
await sql.unsafe(`create database ${name}`);
await sql.end();
const u = new URL(admin); u.pathname = `/${name}`;
await migrate(u.toString());
await installModules(u.toString(), createRegistry(), () => {});
console.log(`e2e database ${name} ready`);
