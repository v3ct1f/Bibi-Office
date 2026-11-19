// Recreates the E2E database and runs core migrations. Used by playwright.config.ts before the API starts.
import postgres from "postgres";
import { migrate } from "@office/db";

const admin = process.env.E2E_DATABASE_URL ?? "postgres://office_owner:office_owner@localhost:55432/postgres";
const name = process.env.E2E_DB_NAME ?? "office_e2e";
const sql = postgres(admin, { max: 1, onnotice: () => {} });
await sql.unsafe(`drop database if exists ${name} with (force)`);
await sql.unsafe(`create database ${name}`);
await sql.end();
const u = new URL(admin); u.pathname = `/${name}`;
await migrate(u.toString());
console.log(`e2e database ${name} ready`);
