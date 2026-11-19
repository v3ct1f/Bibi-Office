import postgres from "postgres";
import { randomBytes } from "node:crypto";
import { migrate } from "@office/db";

/**
 * Creates an isolated, migrated database for one test file.
 * TEST_DATABASE_URL = owner connection to an admin DB (scripts/local-pg.sh or CI service).
 */
export async function createTestDatabase() {
  const admin = process.env.TEST_DATABASE_URL ?? "postgres://office_owner:office_owner@localhost:55432/postgres";
  const name = `office_test_${randomBytes(4).toString("hex")}`;
  const a = postgres(admin, { max: 1, onnotice: () => {} });
  await a.unsafe(`create database ${name}`);
  const url = (user: string) => {
    const u = new URL(admin);
    u.username = user; u.password = user; u.pathname = `/${name}`;
    return u.toString();
  };
  await migrate(url("office_owner"), undefined, () => {});
  return {
    ownerUrl: url("office_owner"),
    appUrl: url("office_app"),
    relayUrl: url("office_relay"),
    async drop() {
      await a.unsafe(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
