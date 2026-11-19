// Per-module database roles: module code runs as office_mod_<prefix>, which can only use that module's own tables.
// Core services reached through ctx (data, files, mail, events, audit, people) switch back to the app role for their call.
import { sql } from "drizzle-orm";
import type { Tx } from "@office/db";
import { tablePrefix } from "@office/sdk";

export const moduleRoleName = (key: string) => `office_mod_${tablePrefix(key)}`;
const enabled = () => process.env.MODULE_DB_ROLES !== "off";

interface RoleState { role: string; coreDepth: number; switching: Promise<unknown> | null }
const states = new WeakMap<object, RoleState>();
const setRole = (tx: Tx, role: string | null) => tx.execute(role ? sql.raw(`set local role ${role}`) : sql`reset role`);

/** Run module code under its own DB role (restores the previous role afterwards, also when nested). */
export async function inModuleRole<T>(tx: Tx, key: string, fn: () => Promise<T>): Promise<T> {
  if (!enabled()) return fn();
  const role = moduleRoleName(key);
  if (!/^office_mod_[a-z][a-z0-9_]{1,40}$/.test(role)) throw new Error(`bad module role ${role}`);
  const prev = states.get(tx);
  states.set(tx, { role, coreDepth: 0, switching: null });
  await setRole(tx, role);
  try {
    return await fn();
  } finally {
    if (prev) states.set(tx, prev); else states.delete(tx);
    // Ignore failure: an aborted transaction or savepoint rolls the role back anyway.
    await setRole(tx, prev ? prev.role : null).catch(() => {});
  }
}

/** Run a core service call as the app role while module code is active (counts overlapping calls). */
export async function asCore<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const st = states.get(tx);
  if (!st) return fn();
  if (st.coreDepth++ === 0) st.switching = setRole(tx, null);
  try {
    await st.switching;
    return await fn();
  } finally {
    if (--st.coreDepth === 0) {
      st.switching = setRole(tx, st.role).catch(() => {});
      await st.switching;
    }
  }
}
