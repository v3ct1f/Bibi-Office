import {
  audit, emitEvent, entityService, forbidden, hasPermission, badRequest, type EntityKey, type RequestContext,
} from "@office/core";
import { memberships, users, type Tx } from "@office/db";
import { and, eq, inArray } from "drizzle-orm";
import type { EntityRepo, Logger, ModuleContext, ModuleDefinition } from "@office/sdk";
import { deleteFileById, readFileById, storeFile, type FileDeps } from "./files.ts";

export interface ModuleState { settings: Record<string, unknown>; secrets: Record<string, string>; files?: FileDeps | undefined }

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
  tx: Tx, base: RequestContext, def: ModuleDefinition, state: ModuleState, log?: Logger, opts: { anonymous?: boolean } = {},
): ModuleContext {
  const anon = !!opts.anonymous;
  const m = def.manifest;
  const requires = new Set(m.permissions.requires);
  const emits = new Set(m.events.emits.map((e) => e.type));

  const repo = (key: EntityKey): EntityRepo => {
    const svc = entityService(key);
    const gate = (a: "read" | "write") => {
      if (anon) throw forbidden("Public requests cannot access core data");
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

  const fileDeps = (a: "read" | "write") => {
    if (anon) throw forbidden("Public requests cannot access files");
    const p = `core:documents.${a}`;
    if (!requires.has(p)) throw forbidden(`Module ${m.key} did not declare ${p} in permissions.requires`);
    if (!state.files) throw new Error("File storage is not configured in this process");
    return state.files;
  };

  const files: ModuleContext["files"] = {
      put: async (f) => { const d = fileDeps("write"); return storeFile(tx, base, d, { filename: f.filename, bytes: f.bytes, declaredType: f.contentType, title: f.title }, m.key); },
    get: async (id) => readFileById(tx, fileDeps("read"), id, m.key),
    remove: async (id) => { fileDeps("write"); await deleteFileById(tx, base, id, m.key); },
  };

  return Object.freeze({
    module: m.key,
    tenantId: base.tenantId,
    actor: { type: base.actor.type, id: base.actor.id, userId: base.actor.userId },
    requestId: base.requestId,
    db: tx,
    data: { contacts: repo("contacts"), companies: repo("companies"), documents: repo("documents"), tasks: repo("tasks") },
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
    files,
    people: {
      async names(ids: string[]) {
        if (anon) return {};
        const uniq = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 500);
        if (!uniq.length) return {};
        const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.tenantId, base.tenantId), inArray(memberships.userId, uniq)));
        return Object.fromEntries(rows.map((r) => [r.id, r.name || r.email]));
      },
    },
    settings: { get: <T,>() => structuredClone(state.settings) as T },
    secrets: { get: (k: string) => state.secrets[k] },
    log: log ?? consoleLogger(m.key),
  });
}

/** Anonymous actor for module public routes: no permissions. */
export function publicContext(tenantId: string, requestId: string, ip?: string, userAgent?: string): RequestContext {
  return {
    tenantId, requestId, ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}),
    actor: { type: "system", id: "public", permissions: new Set() },
  };
}

/** Actor used when the platform (event handler, workflow) invokes a module. */
export function systemContext(tenantId: string, requestId: string, by: string, causation?: RequestContext["causation"]): RequestContext {
  return {
    tenantId, requestId,
    actor: { type: "system", id: by, permissions: new Set(["*"]) },
    ...(causation ? { causation } : {}),
  };
}
