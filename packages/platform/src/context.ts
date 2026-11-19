import {
  audit, emitEvent, entityService, forbidden, hasPermission, badRequest, type EntityKey, type RequestContext,
} from "@office/core";
import { memberships, tenants, users, type Tx } from "@office/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { sqlRows, type EntityRepo, type Logger, type ModuleContext, type ModuleDefinition } from "@office/sdk";
import { deleteFileById, readFileById, storeFile, type FileDeps } from "./files.ts";
import { asCore } from "./module-role.ts";
import { inboundAddress, queueMail, type MailEnv } from "./mail.ts";

export interface ModuleState { settings: Record<string, unknown>; secrets: Record<string, string>; files?: FileDeps | undefined; mail?: MailEnv | undefined }

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

  const core = <T,>(fn: () => Promise<T>) => asCore(tx, fn);
  const repo = (key: EntityKey): EntityRepo => {
    const svc = entityService(key);
    const gate = (a: "read" | "write") => {
      if (anon) throw forbidden("Public requests cannot access core data");
      const p = `core:${key}.${a}`;
      if (!requires.has(p)) throw forbidden(`Module ${m.key} did not declare ${p} in permissions.requires`);
    };
    return {
      list: async (q = {}) => { gate("read"); return core(() => svc.list(tx, base, { limit: Math.min(q.limit ?? 25, 100), cursor: q.cursor, q: q.q })); },
      get: async (id) => { gate("read"); return core(() => svc.get(tx, base, id)); },
      create: async (input) => { gate("write"); return core(() => svc.create(tx, base, input)); },
      update: async (id, input) => { gate("write"); return core(() => svc.update(tx, base, id, input)); },
      remove: async (id) => { gate("write"); return core(() => svc.remove(tx, base, id)); },
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
      put: async (f) => { const d = fileDeps("write"); return core(() => storeFile(tx, base, d, { filename: f.filename, bytes: f.bytes, declaredType: f.contentType, title: f.title }, m.key)); },
    get: async (id) => { const d = fileDeps("read"); return core(() => readFileById(tx, d, id, m.key)); },
    remove: async (id) => { fileDeps("write"); await core(() => deleteFileById(tx, base, id, m.key)); },
  };

  const mailEnv = () => {
    if (!requires.has("core:mail.send")) throw forbidden(`Module ${m.key} did not declare core:mail.send in permissions.requires`);
    if (!state.mail) throw new Error("Mail is not configured in this process");
    return state.mail;
  };
  const mail: ModuleContext["mail"] = {
    send: async (msg) => { const env = mailEnv(); return core(() => queueMail(tx, base, env, m.key, msg)); },
    inboundAddress: async () => { const env = mailEnv(); return core(() => inboundAddress(tx, base, env, m.key)); },
    get appUrl() { return state.mail?.appUrl ?? ""; },
    async publicPageUrl(path: string) {
      const [t] = await core(() => tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, base.tenantId)));
      return `${state.mail?.appUrl ?? ""}/p/${t!.slug}/${m.key}${path.startsWith("/") ? path : `/${path}`}`;
    },
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
        return core(() => emitEvent(tx, base, type, payload, version));
      },
    },
    authz: {
      can: (p: string) => hasPermission(base.actor.permissions, p),
      require: (p: string) => { if (!hasPermission(base.actor.permissions, p)) throw forbidden(`Missing permission ${p}`); },
    },
    audit: {
      log: (action: string, entity?: { type: string; id: string }, diff?: unknown) =>
        core(() => audit(tx, { ...base, actor: { ...base.actor } }, `${m.key}.${action}`, entity, diff)),
    },
    files,
    mail,
    people: {
      async names(ids: string[]) {
        if (anon) return {};
        const uniq = [...new Set(ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 500);
        if (!uniq.length) return {};
        const rows = await core(() => tx.select({ id: users.id, name: users.name, email: users.email }).from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.tenantId, base.tenantId), inArray(memberships.userId, uniq))));
        return Object.fromEntries(rows.map((r) => [r.id, r.name || r.email]));
      },
    },
    clock: {
      async timeZone() { const [r] = sqlRows<{ tz: string }>(await tx.execute(sql`select current_setting('TimeZone') as tz`)); return r!.tz; },
      async today() { const [r] = sqlRows<{ d: string }>(await tx.execute(sql`select current_date::text as d`)); return r!.d; },
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
