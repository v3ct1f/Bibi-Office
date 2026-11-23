import { eraseBusiness, listErasableBusinesses } from "@office/core";
import type { Db } from "@office/db";
import type { Identity } from "./identity.ts";

/** Most businesses erased in one run: a safety net so a bug can never wipe everything in one go. */
const MAX_PER_RUN = 20;

/**
 * Erases the businesses that are due (deleted 30+ days ago, or subscription ended 90+ days ago) and deletes the
 * sign-in accounts of people who belonged to nothing else. Safe to run on several servers at once: the database
 * refuses a business that is not due or already gone.
 */
export async function eraseDueBusinesses(db: Db, identity: Identity | null, log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void }) {
  let erased = 0;
  for (const id of await listErasableBusinesses(db, MAX_PER_RUN)) {
    try {
      const subs = await eraseBusiness(db, id);
      erased += 1;
      for (const sub of subs) {
        try { await identity?.deleteAccount?.(sub); } catch (err) { log.warn({ err }, "sign-in account could not be deleted"); }
      }
      log.info({ tenantId: id, accountsErased: subs.length }, "business erased");
    } catch (err) {
      log.warn({ err, tenantId: id }, "business could not be erased");
    }
  }
  return erased;
}

/** Runs the erasure every 6 hours (first run 2 minutes after start). Returns a function that stops it. */
export function scheduleErasure(db: Db, identity: Identity | null, log: Parameters<typeof eraseDueBusinesses>[2]) {
  const run = () => void eraseDueBusinesses(db, identity, log).catch((err) => log.warn({ err }, "erasure run failed"));
  const first = setTimeout(run, 2 * 60_000);
  const every = setInterval(run, 6 * 3600_000);
  first.unref(); every.unref();
  return () => { clearTimeout(first); clearInterval(every); };
}
