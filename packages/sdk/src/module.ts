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

/** A member of the tenant (an employee), as modules see them. */
export interface Person { userId: string; name: string; email: string; roles: string[] }

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
  /** Active members of the tenant. Needs "core:members.read" in the manifest's `requires` (not in the caller's grants). */
  readonly people: {
    list(): Promise<Person[]>; get(userId: string): Promise<Person | null>;
    /** Whether an active member holds a permission (e.g. before emailing them something). */
    can(userId: string, permission: string): Promise<boolean>;
  };
  readonly events: { emit(type: string, payload: Record<string, unknown>, version?: number): Promise<string> };
  readonly authz: { can(permission: string): boolean; require(permission: string): void };
  readonly audit: { log(action: string, entity?: { type: string; id: string }, diff?: unknown): Promise<void> };
  readonly settings: { get<T = Record<string, unknown>>(): T };
  readonly secrets: { get(key: string): string | undefined };
  /**
   * Numbers other modules offer (see MetricSpec). Needs "core:metrics.read" in the manifest's `requires`.
   * Only metrics of enabled modules that the caller (or `as`, a member's user id) may read are listed or computed.
   */
  readonly metrics: {
    /** `all`: every metric of enabled modules, readable or not (names only, e.g. to label a tile someone can't see). */
    list(opts?: { as?: string; all?: boolean }): Promise<MetricInfo[]>;
    get(key: string, range: MetricRange, opts?: { as?: string }): Promise<MetricResult>;
  };
  readonly log: Logger;
}

// ───────── Metrics (KPIs) ─────────
export const METRIC_UNITS = ["money", "count", "hours", "minutes", "days", "percent"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];
export const METRIC_GROUPS = ["money", "sales", "team", "operations", "support", "other"] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];

/**
 * A period to compute a metric for: dates `from` (inclusive) to `to` (exclusive) in the company's time zone,
 * and the same bounds as instants (`start`, `end`: ISO strings, ready for SQL) for timestamp columns.
 * `current` is true when the period includes now.
 */
export interface MetricRange { from: string; to: string; start: string; end: string; timeZone: string; current: boolean }
export interface MetricValue { value: number | null; currency?: string | undefined }
/** null value = can't be computed for this period (e.g. a live count asked for a past month). */
export interface MetricResult extends MetricValue { error?: string }

/**
 * A number a module offers to dashboards, computed live from its own tables.
 * Keys are "<module>.<name>". The reader needs `permission`.
 */
export interface MetricSpec {
  label: string;
  description: string;
  group: MetricGroup;
  unit: MetricUnit;
  /** "total": adds up over the period (revenue). "snapshot": the value at the end of the period (unpaid invoices). */
  kind: "total" | "snapshot";
  /** Whether a higher number is good news. */
  better: "up" | "down";
  permission: string;
  /** Page of this module that shows the detail, relative to the module (e.g. "/invoices"). */
  link?: string;
  compute(ctx: ModuleContext, range: MetricRange): Promise<MetricValue | number | null>;
}
export interface MetricInfo extends Omit<MetricSpec, "compute" | "permission" | "link"> { key: string; module: string; link: string | null }

export interface RouteSpec<B extends z.ZodType = z.ZodType, Q extends z.ZodType = z.ZodType, P extends z.ZodType = z.ZodType> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;                      // relative to /api/v1/m/<key>
  permission: string;                // required; deny by default
  body?: B; query?: Q; params?: P;
  status?: number;
  /** Max request body in bytes (default 1 MiB; at most 10 MiB), e.g. for file uploads. */
  bodyLimit?: number;
  handler(ctx: ModuleContext, req: { body: z.infer<B>; query: z.infer<Q>; params: z.infer<P> }): Promise<unknown>;
}

/**
 * Route that needs no sign-in, e.g. a signing page for people outside the company.
 * Mounted at /api/v1/public/t/<tenantId>/m/<key><path> and run inside that tenant (RLS) for an enabled module,
 * with NO permissions: the handler must check its own secret (a token in the path or body) and reveal nothing
 * without it. Rate limited per IP.
 */
export interface PublicRouteSpec<B extends z.ZodType = z.ZodType, Q extends z.ZodType = z.ZodType, P extends z.ZodType = z.ZodType> {
  method: "GET" | "POST";
  path: string;
  body?: B; query?: Q; params?: P;
  status?: number;
  bodyLimit?: number;
  handler(ctx: ModuleContext, req: { body: z.infer<B>; query: z.infer<Q>; params: z.infer<P>; client: { ip: string; userAgent: string | null } }): Promise<unknown>;
}

export interface ActionSpec<I extends z.ZodType = z.ZodType> {
  label: string;
  /** Needed to put this action in a workflow; the workflow runs with the access of the person who last saved it. */
  permission: string;
  input: I;
  run(ctx: ModuleContext, input: z.infer<I>): Promise<Record<string, unknown> | void>;
}

/**
 * Scheduled job, run by the worker once per interval for every tenant that has the module enabled.
 * Runs as actor `module:<key>` in one tenant tx. Must be idempotent: a crash means it simply runs again next time.
 */
export interface JobSpec {
  label: string;
  everyMinutes: number;
  run(ctx: ModuleContext): Promise<void>;
}

export const JOB_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

export interface ModuleDefinition {
  manifest: Manifest;
  /** Absolute path to SQL migrations (tables must be "<prefix>_*" with tenant_id + RLS). */
  migrationsDir?: string;
  routes?: RouteSpec[];
  /** Routes without sign-in (see PublicRouteSpec). */
  publicRoutes?: PublicRouteSpec[];
  handlers?: Record<string, (ctx: ModuleContext, event: EventEnvelope) => Promise<void>>;
  actions?: Record<string, ActionSpec>;
  lifecycle?: Partial<Record<"enable" | "disable", (ctx: ModuleContext) => Promise<void>>>;
  /** Scheduled jobs keyed by job key (e.g. "mark_overdue"). */
  jobs?: Record<string, JobSpec>;
  /** Numbers for dashboards, keyed "<module>.<name>" (see MetricSpec). */
  metrics?: Record<string, MetricSpec>;
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
  for (const [k, a] of Object.entries(def.actions ?? {})) {
    if (!perms.has(a.permission) && !manifest.permissions.requires.includes(a.permission)) errors.push(`action ${k} uses undeclared permission ${a.permission}`);
  }
  for (const r of def.publicRoutes ?? []) {
    if (!/^\/[a-z0-9/:_-]*$/i.test(r.path)) errors.push(`public route ${r.method} ${r.path} has an invalid path`);
  }
  for (const [k, j] of Object.entries(def.jobs ?? {})) {
    if (!JOB_KEY_RE.test(k)) errors.push(`job key ${k} must match ${JOB_KEY_RE}`);
    if (!Number.isInteger(j.everyMinutes) || j.everyMinutes < 1 || j.everyMinutes > 7 * 24 * 60) {
      errors.push(`job ${k} everyMinutes must be an integer between 1 and 10080`);
    }
  }
  for (const [k, m] of Object.entries(def.metrics ?? {})) {
    if (!METRIC_KEY_RE.test(k) || !k.startsWith(`${manifest.key}.`)) errors.push(`metric ${k} must look like "${manifest.key}.<name>"`);
    if (!perms.has(m.permission) && !manifest.permissions.requires.includes(m.permission)) errors.push(`metric ${k} uses undeclared permission ${m.permission}`);
  }
  if (errors.length) throw new Error(`Module ${manifest.key}: ${errors.join("; ")}`);
  return { ...def, manifest };
}

/** Helper to keep route typing when building the routes array. */
export const route = <B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType>(r: RouteSpec<B, Q, P>) => r as unknown as RouteSpec;
export const publicRoute = <B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType>(r: PublicRouteSpec<B, Q, P>) => r as unknown as PublicRouteSpec;
export const action = <I extends z.ZodType>(a: ActionSpec<I>) => a as unknown as ActionSpec;
export const job = (j: JobSpec) => j;
export const metric = (m: MetricSpec) => m;
export const METRIC_KEY_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]{0,60}$/;

/** Error a module throws to answer with a 4xx (modules may not import @office/core). */
export class ModuleError extends Error {
  /** keepChanges: save what the request already wrote (e.g. a usage record for a paid call that failed) before answering with the error. */
  readonly keepChanges: boolean;
  constructor(public statusCode: number, public code: string, message: string, opts?: { keepChanges?: boolean }) {
    super(message);
    this.keepChanges = opts?.keepChanges ?? false;
  }
}
export const moduleErrors = {
  badRequest: (m: string) => new ModuleError(400, "bad_request", m),
  forbidden: (m: string) => new ModuleError(403, "forbidden", m),
  notFound: (what = "Resource") => new ModuleError(404, "not_found", `${what} not found`),
  conflict: (m: string) => new ModuleError(409, "conflict", m),
};
