/**
 * Local dev worker without NATS/Temporal: relays the outbox and dispatches each event in-process
 * (module handlers + workflows via InlineRunner), delivers webhooks and runs scheduled module jobs.
 * Pairs with `pnpm dev:local` (same `office_dev` database and dev SECRETS_KEY). Also used by E2E.
 *
 *   pnpm --filter @office/worker dev:local [--health-port 3199]
 *
 * Dev-only: refuses NODE_ENV=production. Production uses src/main.ts (JetStream, at-least-once, Temporal).
 */
import { createServer } from "node:http";
import postgres from "postgres";
import pino from "pino";
import { createDb } from "@office/db";
import { createRegistry } from "@office/modules";
import { configureMail, mailProviderFromEnv } from "@office/module-mail";
import { deliverDue, dispatchEvent, InlineRunner, runDueJobs, SecretBox, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import { relayBatch, type Publisher } from "../src/relay.ts";

if (process.env.NODE_ENV === "production") {
  console.error("worker dev-local refuses to run with NODE_ENV=production");
  process.exit(1);
}
const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

const admin = new URL(process.env.DEV_DATABASE_URL ?? "postgres://office_owner:office_owner@localhost:55432/postgres");
admin.pathname = `/${process.env.DEV_DB_NAME ?? "office_dev"}`;
const as = (user: string) => { const u = new URL(admin); u.username = user; u.password = user; return u.toString(); };
const appUrl = process.env.DATABASE_URL_APP ?? as("office_app");
const relayUrl = process.env.DATABASE_URL_RELAY ?? as("office_relay");
const secrets = new SecretBox(process.env.SECRETS_KEY ?? Buffer.alloc(32, 1).toString("base64"));

const relaySql = postgres(relayUrl, { max: 4, onnotice: () => {} });
const app = createDb(appUrl, { max: 10 });
const registry = createRegistry();
// Mail's every-minute job reads a real mail server (MAIL_PROVIDER=imap) from here, not inside page requests.
configureMail(mailProviderFromEnv(process.env));
const http = { allowPrivate: true, requireHttps: false };
const exec: ExecDeps = { db: app.db, registry, secrets, http };
const runner = new InlineRunner(exec);

// "Publishing" = dispatching right away. A throw leaves the outbox row unpublished, so it is retried.
const dec = new TextDecoder();
const pub: Publisher = {
  publish: async (_subject, data) => {
    const e = JSON.parse(dec.decode(data)) as EventEnvelope;
    const r = await dispatchEvent({ ...exec, runner }, e);
    log.debug({ type: e.type, id: e.id, runs: r.runs.length }, "dispatched");
  },
};

let running = true;
process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });

async function loop(name: string, fn: () => Promise<number>, maxIdleMs = 1000) {
  let idle = 50;
  while (running) {
    try { const n = await fn(); idle = n ? 0 : Math.min(idle * 2 || 50, maxIdleMs); }
    catch (e) { log.error({ err: e, loop: name }, "loop iteration failed"); idle = maxIdleMs; }
    if (idle) await new Promise((r) => setTimeout(r, idle));
  }
}

const hp = process.argv.indexOf("--health-port");
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? (hp > 0 ? process.argv[hp + 1] : 0));
const server = healthPort ? createServer((_q, res) => { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); }).listen(healthPort, "127.0.0.1") : null;

log.info({ db: admin.pathname.slice(1), healthPort: healthPort || undefined }, "local worker started (in-process events, no NATS)");
await Promise.all([
  loop("outbox", () => relayBatch(relaySql, pub), 500),
  loop("webhooks", () => deliverDue(relaySql, secrets, http), 2000),
  loop("module-jobs", () => runDueJobs(relaySql, { db: app.db, registry, secrets }), 30_000),
]);
server?.close();
await relaySql.end();
await app.close();
log.info("local worker stopped");
