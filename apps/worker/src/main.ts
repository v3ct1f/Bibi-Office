import postgres from "postgres";
import { AckPolicy, connect, DeliverPolicy, RetentionPolicy, StorageType, type JsMsg } from "nats";
import pino from "pino";
import { createDb } from "@office/db";
import { createRegistry } from "@office/modules";
import {
  dispatchEvent, deliverDue, InlineRunner, runDueJobs, SecretBox, runRefFor, TemporalRunner, temporalActivities, TASK_QUEUE,
  type ExecDeps, type WorkflowRunner,
} from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import { relayBatch, type Publisher } from "./relay.ts";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const env = (k: string) => { const v = process.env[k]; if (!v) { log.fatal(`${k} required`); process.exit(1); } return v; };
const PROD = process.env.NODE_ENV === "production";
const allowPrivate = process.env.WEBHOOK_ALLOW_PRIVATE === "true";
if (PROD && allowPrivate) { log.fatal("WEBHOOK_ALLOW_PRIVATE is not allowed in production"); process.exit(1); }

const relaySql = postgres(env("DATABASE_URL_RELAY"), { max: 4 });
const app = createDb(env("DATABASE_URL_APP"), { max: 10 });
const secrets = new SecretBox(env("SECRETS_KEY"));
const registry = createRegistry();
const http = { allowPrivate, requireHttps: PROD };
const exec: ExecDeps = { db: app.db, registry, secrets, http };

// ── Workflow runner: Temporal when configured, else in-process.
let runner: WorkflowRunner = new InlineRunner(exec);
let temporalWorker: { run(): Promise<void>; shutdown(): void } | undefined;
if (process.env.TEMPORAL_ADDRESS) {
  const { Worker, NativeConnection } = await import("@temporalio/worker");
  runner = await TemporalRunner.connect(exec, process.env.TEMPORAL_ADDRESS);
  temporalWorker = await Worker.create({
    connection: await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS }),
    taskQueue: TASK_QUEUE,
    workflowsPath: import.meta.resolve("@office/platform/temporal-workflow").replace("file://", ""),
    activities: temporalActivities(exec),
  });
  log.info("temporal runner enabled");
}

// ── NATS
const nc = await connect({ servers: process.env.NATS_URL ?? "nats://localhost:4222", name: "office-worker" });
const jsm = await nc.jetstreamManager();
await jsm.streams.add({
  name: "OFFICE_EVENTS", subjects: ["office.>"], retention: RetentionPolicy.Limits,
  storage: StorageType.File, max_age: 7 * 24 * 3600 * 1e9, duplicate_window: 10 * 60 * 1e9,
}).catch((e) => { if (!String(e).includes("already in use")) throw e; });
await jsm.consumers.add("OFFICE_EVENTS", {
  durable_name: "dispatcher", ack_policy: AckPolicy.Explicit, deliver_policy: DeliverPolicy.All,
  max_deliver: 20, ack_wait: 60 * 1e9, backoff: [1e9, 5e9, 30e9, 120e9, 600e9].map((n) => n),
}).catch((e) => { if (!String(e).includes("already")) throw e; });
const js = nc.jetstream();
const pub: Publisher = { publish: async (s, d, msgID) => { await js.publish(s, d, { msgID }); } };

let running = true;
const stop = () => { running = false; temporalWorker?.shutdown(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

/** Poll loop with idle backoff. */
async function loop(name: string, fn: () => Promise<number>, maxIdleMs = 1000) {
  let idle = 50;
  while (running) {
    try { const n = await fn(); idle = n ? 0 : Math.min(idle * 2 || 50, maxIdleMs); }
    catch (e) { log.error({ err: e, loop: name }, "loop iteration failed"); idle = maxIdleMs; }
    if (idle) await new Promise((r) => setTimeout(r, idle));
  }
}

async function consumeEvents() {
  const consumer = await js.consumers.get("OFFICE_EVENTS", "dispatcher");
  const msgs = await consumer.consume({ max_messages: 64 });
  for await (const m of msgs as AsyncIterable<JsMsg>) {
    if (!running) break;
    try {
      const e = m.json<EventEnvelope>();
      const r = await dispatchEvent({ db: app.db, registry, secrets, runner }, e);
      log.debug({ type: e.type, id: e.id, ...r, runs: r.runs.length }, "dispatched");
      m.ack();
    } catch (err) {
      log.error({ err }, "dispatch failed; will redeliver");
      m.nak();
    }
  }
}

log.info("worker started");
await Promise.all([
  loop("outbox-relay", () => relayBatch(relaySql, pub)),
  loop("webhooks", () => deliverDue(relaySql, secrets, http), 2000),
  loop("stale-runs", async () => {
    // Runs left pending (crash between commit and start) are restarted. Temporal dedupes by workflowId.
    const stale = await relaySql<{ id: string; tenant_id: string }[]>`
      select id, tenant_id from workflow_runs where status = 'pending' and started_at < now() - interval '5 minutes' limit 100`;
    for (const s of stale) {
      const ref = await runRefFor(app.db, s.tenant_id, s.id);
      if (ref) await runner.start(ref);
    }
    return 0;
  }, 60_000),
  loop("module-jobs", () => runDueJobs(relaySql, { db: app.db, registry, secrets }), 30_000),
  consumeEvents(),
  temporalWorker?.run(),
]);
await nc.drain();
await relaySql.end();
await app.close();
log.info("worker stopped");
