import postgres from "postgres";
import { connect, RetentionPolicy, StorageType } from "nats";
import pino from "pino";
import { relayBatch, type Publisher } from "./relay.ts";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const DB = process.env.DATABASE_URL_RELAY;
const NATS_URL = process.env.NATS_URL ?? "nats://localhost:4222";
if (!DB) { log.fatal("DATABASE_URL_RELAY required"); process.exit(1); }

const sql = postgres(DB, { max: 2 });
const nc = await connect({ servers: NATS_URL, name: "office-outbox-relay" });
const jsm = await nc.jetstreamManager();
await jsm.streams.add({
  name: "OFFICE_EVENTS", subjects: ["office.>"], retention: RetentionPolicy.Limits,
  storage: StorageType.File, max_age: 7 * 24 * 3600 * 1e9, duplicate_window: 10 * 60 * 1e9,
}).catch(async (e) => { if (!String(e).includes("already in use")) throw e; });
const js = nc.jetstream();
const pub: Publisher = { publish: async (s, d, msgID) => { await js.publish(s, d, { msgID }); } };

let running = true;
const stop = async () => { running = false; };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

log.info("outbox relay started");
let idle = 50;
while (running) {
  try {
    const n = await relayBatch(sql, pub);
    idle = n ? 0 : Math.min(idle * 2 || 50, 1000); // backoff when idle; tight loop under load
    if (n) log.debug({ n }, "relayed");
  } catch (e) {
    log.error({ err: e }, "relay batch failed");
    idle = 1000;
  }
  if (idle) await new Promise((r) => setTimeout(r, idle));
}
await nc.drain();
await sql.end();
log.info("outbox relay stopped");
