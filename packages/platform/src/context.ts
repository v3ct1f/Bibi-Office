import {
  audit, emitEvent, entityService, forbidden, hasPermission, badRequest, listMembers, type EntityKey, type RequestContext,
} from "@office/core";
import type { Tx } from "@office/db";
import type { EntityRepo, Logger, ModuleContext, ModuleDefinition, Person } from "@office/sdk";

export interface ModuleState { settings: Record<string, unknown>; secrets: Record<string, string> }

const consoleLogger = (module: string): Logger => {
  const w = (lvl: "debug" | "info" | "warn" | "error") => (o: object | string, msg?: string) =>
    console[lvl === "debug" ? "log" : lvl](JSON.stringify({ module, lvl, ...(typeof o === "string" ? { msg: o } : { ...o, msg }) }));
  return { debug: w("debug"), info: w("info"), warn: w("warn"), error: w("error") };
};

/**
 * Build the SDK ctx for a module. Core data access needs the permission in the manifest's
 * `requires` AND in the caller's grants (user/API key, or system for handlers/workflows).
 */
export function createModuleContext(
  tx: Tx, base: RequestContext, def: ModuleDefinition, state: ModuleState, log?: Logger,
): ModuleContext {
  const m = def.manifest;
  const requires = new Set(m.permissions.requires);
  const emits = new Set(m.events.emits.map((e) => e.type));

  const repo = (key: EntityKey): EntityRepo => {
    const svc = entityService(key);
    const gate = (a: "read" | "write") => {
      const p = `core:${key}.${a}`;
      if (!requires.has(p)) throw forbidden(`Module ${m.key} did not declare ${p} in permissions.requires`);
    };
    return {
      list: async (q = {}) => { gate("read"); return svc.list(tx, base, { limit: Math.min(q.limit ?? 25, 100), cursor: q.cursor, q: q.q }); },
      get: async (id) => { gate("read"); return svc.get(tx, base, id); },
      create: async (input) => { gate("write"); return svc.create(tx, base, input); },
      update: async (id, input) => { gate("write"); return svc.update(tx, base, id, input); },
      remove: async (id) => { gate("write"); return svc.remove(tx, base, id); },
    };
  };

  let peopleCache: Promise<Person[]> | null = null;
  const people = () => {
    if (!requires.has("core:members.read")) throw forbidden(`Module ${m.key} did not declare core:members.read in permissions.requires`);
    peopleCache ??= listMembers(tx, base).then((rows) => rows.filter((r) => r.status === "active")
      .map((r) => ({ userId: r.userId, name: r.name || r.email, email: r.email, roles: r.roles })));
    return peopleCache;
  };

  return Object.freeze({
    module: m.key,
    tenantId: base.tenantId,
    actor: { type: base.actor.type, id: base.actor.id, userId: base.actor.userId },
    requestId: base.requestId,
    db: tx,
    data: { contacts: repo("contacts"), companies: repo("companies"), documents: repo("documents"), tasks: repo("tasks") },
    people: {
      list: async () => [...await people()],
      get: async (userId: string) => (await people()).find((p) => p.userId === userId) ?? null,
    },
    events: {
      async emit(type: string, payload: Record<string, unknown>, version = 1) {
        if (!emits.has(type)) throw badRequest(`Module ${m.key} cannot emit undeclared event ${type}`);
        return emitEvent(tx, base, type, payload, version);
      },
    },
    authz: {
      can: (p: string) => hasPermission(base.actor.permissions, p),
      require: (p: string) => { if (!hasPermission(base.actor.permissions, p)) throw forbidden(`Missing permission ${p}`); },
    },
    audit: {
      log: (action: string, entity?: { type: string; id: string }, diff?: unknown) =>
        audit(tx, { ...base, actor: { ...base.actor } }, `${m.key}.${action}`, entity, diff),
    },
    settings: { get: <T,>() => structuredClone(state.settings) as T },
    secrets: { get: (k: string) => state.secrets[k] },
    log: log ?? consoleLogger(m.key),
  });
}

/** Actor used when the platform (event handler, workflow) invokes a module. */
export function systemContext(tenantId: string, requestId: string, by: string, causation?: RequestContext["causation"]): RequestContext {
  return {
    tenantId, requestId,
    actor: { type: "system", id: by, permissions: new Set(["*"]) },
    ...(causation ? { causation } : {}),
  };
}
