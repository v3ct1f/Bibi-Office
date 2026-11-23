/**
 * Local dev: (re)sends a program owner the "You're now the owner of Office" email, with a "set your password"
 * link if they don't have a password yet. Uses the local office_dev database, the local sign-in server and the
 * mail settings in the repo's .env.local.
 *
 *   pnpm --filter @office/api owner:welcome you@example.com [--by "Who handed it over"]
 */
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createDb } from "@office/db";
import { isPlatformAdmin } from "@office/core";
import { devIdentity } from "../src/identity.ts";
import { ownershipTransferredEmail, smtpMailer } from "../src/mail.ts";

const email = process.argv[2]?.trim().toLowerCase();
const byArg = process.argv.indexOf("--by");
const by = byArg > 0 ? process.argv[byArg + 1]! : "The previous owner";
if (!email || !email.includes("@")) { console.error("usage: owner-welcome.ts <email> [--by <name>]"); process.exit(2); }

const localEnv = new URL("../../../.env.local", import.meta.url);
const vars = existsSync(localEnv) ? parseEnv(readFileSync(localEnv, "utf8")) : {};
const mailer = smtpMailer(process.env.MAIL_SMTP_URL ?? vars.MAIL_SMTP_URL, process.env.MAIL_FROM ?? vars.MAIL_FROM);
if (!mailer) { console.error("Email isn't set up: add MAIL_SMTP_URL and MAIL_FROM to .env.local"); process.exit(1); }

const dbUrl = process.env.DATABASE_URL_APP ?? `postgres://office_app:office_app@localhost:55432/${process.env.DEV_DB_NAME ?? "office_dev"}`;
const { db, close } = createDb(dbUrl, { max: 1 });
try {
  if (!(await isPlatformAdmin(db, email))) { console.error(`${email} is not a program owner`); process.exit(1); }
  const identity = devIdentity(process.env.IDP_ADMIN_URL ?? "http://localhost:8081/dev-admin", process.env.IDP_ADMIN_SECRET ?? "dev-idp-admin-secret", (e) => console.error(e));
  const pw = await identity!.passwordLink(email, `${process.env.APP_URL ?? "http://localhost:5173"}/admin`);
  if (!pw) { console.error("The local sign-in server didn't answer; start it first (dev-oidc on port 8081)"); process.exit(1); }
  const adminUrl = `${process.env.APP_URL ?? "http://localhost:5173"}/admin`;
  await mailer.send({ to: email, ...ownershipTransferredEmail({ by, adminUrl, passwordLink: pw.hasPassword ? null : pw.link }) });
  console.log(`sent to ${email}${pw.hasPassword ? " (already has a password, so no password link)" : " with a set-your-password link"}`);
} finally {
  await close();
}
