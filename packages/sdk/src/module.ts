import type { z } from "zod";
import type { Tx } from "@office/db";
import { parseManifest, type Manifest, type ManifestInput } from "./manifest.ts";

export interface EventEnvelope<P = Record<string, unknown>> {
  id: string; tenantId: string; type: string; version: number; payload: P;
  actor: { type: string | null; id: string | null };
  causationId: string | null; correlationId: string; depth: number; occurredAt: string;
}

export interface EntityRepo {
  list(q?: { limit?: number; cursor?: string; q?: string }): Promise<{ data: Record<string, unknown>[]; nextCursor: string | null }>;
  get(id: string): Promise<Record<string, unknown>>;
  create(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  remove(id: string): Promise<void>;
}

export interface Logger {
  debug(o: object | string, msg?: string): void;
  info(o: object | string, msg?: string): void;
  warn(o: object | string, msg?: string): void;
  error(o: object | string, msg?: string): void;
}

/**
 * The only door from a module to the platform. Scoped to one tenant and transaction.
 * Data access requires the permission in BOTH the caller's grants and the manifest's `requires`.
 */
export interface ModuleContext {
  readonly module: string;
  readonly tenantId: string;
  readonly actor: { type: "user" | "api_key" | "system" | "module"; id: string; userId?: string | undefined };
  readonly requestId: string;
  /** RLS-bound transaction. Use only your own `<module>_*` tables. */
  readonly db: Tx;
  readonly data: { contacts: EntityRepo; companies: EntityRepo; documents: EntityRepo; tasks: EntityRepo };
  readonly events: { emit(type: string, payload: Record<string, unknown>, version?: number): Promise<string> };
  readonly authz: { can(permission: string): boolean; require(permission: string): void };
  readonly audit: { log(action: string, entity?: { type: string; id: string }, diff?: unknown): Promise<void> };
  readonly settings: { get<T = Record<string, unknown>>(): T };
  readonly secrets: { get(key: string): string | undefined };
  readonly log: Logger;
}

export interface RouteSpec<B extends z.ZodType = z.ZodType, Q extends z.ZodType = z.ZodType, P extends z.ZodType = z.ZodType> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;                      // relative to /api/v1/m/<key>
  permission: string;                // required; deny by default
  body?: B; query?: Q; params?: P;
  status?: number;
  handler(ctx: ModuleContext, req: { body: z.infer<B>; query: z.infer<Q>; params: z.infer<P> }): Promise<unknown>;
}

/** A scheduled per-tenant job; the worker runs it about every `everySeconds` for tenants with the module enabled. */
export interface JobSpec {
  everySeconds: number;                // >= 60
  /** Must be idempotent: a job may run again after a crash. Return a count for logs. */
  run(ctx: ModuleContext): Promise<number | void>;
}

/** Return from a route handler to send a file (e.g. a PDF) instead of JSON. */
export interface FileResponse { readonly __file: true; contentType: string; filename: string; body: Uint8Array; inline?: boolean }
export const file = (f: Omit<FileResponse, "__file">): FileResponse => ({ __file: true, ...f });
export const isFileResponse = (v: unknown): v is FileResponse => !!v && typeof v === "object" && (v as FileResponse).__file === true;

/** Throw from module code to return an RFC 9457 problem with this status (4xx only). */
export class ModuleError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 422, public code: string, message: string, public details?: unknown) { super(message); }
}
export const moduleErrors = {
  badRequest: (m: string, d?: unknown) => new ModuleError(400, "bad_request", m, d),
  notFound: (what = "Resource") => new ModuleError(404, "not_found", `${what} not found`),
  conflict: (m: string) => new ModuleError(409, "conflict", m),
  unprocessable: (m: string, d?: unknown) => new ModuleError(422, "unprocessable", m, d),
};

export interface ActionSpec<I extends z.ZodType = z.ZodType> {
  label: string;
  input: I;
  run(ctx: ModuleContext, input: z.infer<I>): Promise<Record<string, unknown> | void>;
}

export interface ModuleDefinition {
  manifest: Manifest;
  /** Absolute path to SQL migrations (tables must be "<prefix>_*" with tenant_id + RLS). */
  migrationsDir?: string;
  routes?: RouteSpec[];
  handlers?: Record<string, (ctx: ModuleContext, event: EventEnvelope) => Promise<void>>;
  actions?: Record<string, ActionSpec>;
  lifecycle?: Partial<Record<"enable" | "disable", (ctx: ModuleContext) => Promise<void>>>;
  /** Scheduled per-tenant jobs, keyed by name ([a-z0-9-]+). */
  jobs?: Record<string, JobSpec>;
}

export interface DefineModuleInput extends Omit<ModuleDefinition, "manifest"> { manifest: ManifestInput }

/** Typed helper for module authors; validates the manifest against the code at load time. */
export function defineModule(def: DefineModuleInput): ModuleDefinition {
  const manifest = parseManifest(def.manifest);
  const errors: string[] = [];
  const subs = new Set(manifest.events.subscribes);
  for (const k of Object.keys(def.handlers ?? {})) if (!subs.has(k)) errors.push(`handler ${k} not in events.subscribes`);
  for (const s of subs) if (!def.handlers?.[s]) errors.push(`events.subscribes ${s} has no handler`);
  const declared = new Set(manifest.workflow.actions.map((a) => a.key));
  for (const k of Object.keys(def.actions ?? {})) if (!declared.has(k)) errors.push(`action ${k} not in workflow.actions`);
  for (const k of declared) if (!def.actions?.[k]) errors.push(`workflow.actions ${k} has no implementation`);
  const perms = new Set(manifest.permissions.declares.map((p) => p.key));
  for (const r of def.routes ?? []) {
    if (!perms.has(r.permission) && !manifest.permissions.requires.includes(r.permission)) {
      errors.push(`route ${r.method} ${r.path} uses undeclared permission ${r.permission}`);
    }
  }
  for (const [k, j] of Object.entries(def.jobs ?? {})) {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(k)) errors.push(`job name ${k} invalid`);
    if (!(j.everySeconds >= 60)) errors.push(`job ${k} everySeconds must be >= 60`);
  }
  if (errors.length) throw new Error(`Module ${manifest.key}: ${errors.join("; ")}`);
  return { ...def, manifest };
}

/** Helper to keep route typing when building the routes array. */
export const route = <B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType>(r: RouteSpec<B, Q, P>) => r as unknown as RouteSpec;
export const action = <I extends z.ZodType>(a: ActionSpec<I>) => a as unknown as ActionSpec;
