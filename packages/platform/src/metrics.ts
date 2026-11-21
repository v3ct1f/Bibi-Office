import { sql } from "drizzle-orm";
import { forbidden, hasPermission, notFound, resolveMembership, type RequestContext } from "@office/core";
import type { Tx } from "@office/db";
import type { MetricInfo, MetricRange, MetricResult, MetricSpec, MetricValue, ModuleContext, ModuleDefinition } from "@office/sdk";
import { createModuleContext } from "./context.ts";
import { enabledModuleKeys, loadEnabledModule, type ModuleDeps } from "./tenant-modules.ts";

/** Metrics the core itself offers (contacts, tasks, members), computed straight from core tables. */
interface CoreMetric extends Omit<MetricSpec, "compute"> { compute(tx: Tx, r: MetricRange): Promise<number | null> }
const one = async (tx: Tx, q: ReturnType<typeof sql>) => {
  const [row] = await tx.execute<{ n: string | number | null }>(q) as unknown as { n: string | number | null }[];
  return row?.n == null ? 0 : Number(row.n);
};
export const CORE_METRICS: Record<string, CoreMetric> = {
  "core.contacts_new": {
    label: "New contacts", description: "People added to Contacts in the period.", group: "sales", unit: "count", kind: "total", better: "up",
    permission: "core:contacts.read", link: "/contacts",
    compute: (tx, r) => one(tx, sql`select count(*) as n from contacts where deleted_at is null and created_at >= ${r.start} and created_at < ${r.end}`),
  },
  "core.tasks_overdue": {
    label: "Overdue tasks", description: "Open tasks past their due date, right now.", group: "operations", unit: "count", kind: "snapshot", better: "down",
    permission: "core:tasks.read", link: "/tasks",
    compute: async (tx, r) => r.current
      ? one(tx, sql`select count(*) as n from tasks where deleted_at is null and status in ('open', 'in_progress') and due_at < now()`)
      : null,
  },
  "core.members": {
    label: "Team members", description: "Active members of the workspace, right now.", group: "team", unit: "count", kind: "snapshot", better: "up",
    permission: "core:members.read", link: "/settings/members",
    compute: async (tx, r) => r.current ? one(tx, sql`select count(*) as n from memberships where status = 'active'`) : null,
  },
};

const info = (key: string, module: string, s: Omit<MetricSpec, "compute">, prefix: string): MetricInfo => ({
  key, module, label: s.label, description: s.description, group: s.group, unit: s.unit, kind: s.kind, better: s.better,
  link: s.link ? `${prefix}${s.link}` : null,
});

const normalise = (v: MetricValue | number | null): MetricValue => {
  const out = typeof v === "number" || v === null ? { value: v } : v;
  return { ...out, value: out.value == null || !Number.isFinite(out.value) ? null : Math.round(out.value * 100) / 100 };
};

/** Build `ctx.metrics` for a module whose manifest requires core:metrics.read. */
export function metricsFor(tx: Tx, base: RequestContext, caller: ModuleDefinition, d: ModuleDeps | undefined): ModuleContext["metrics"] {
  const gate = () => {
    if (!caller.manifest.permissions.requires.includes("core:metrics.read")) {
      throw forbidden(`Module ${caller.manifest.key} did not declare core:metrics.read in permissions.requires`);
    }
    if (!d) throw new Error("metrics are not available here");
    return d;
  };
  const permsCache = new Map<string, ReadonlySet<string>>();
  const permsOf = async (as?: string): Promise<ReadonlySet<string>> => {
    if (!as) return base.actor.permissions;
    let p = permsCache.get(as);
    if (!p) {
      p = (await resolveMembership(tx, base.tenantId, as))?.permissions ?? new Set<string>();
      permsCache.set(as, p);
    }
    return p;
  };
  let enabled: Promise<Set<string>> | null = null;
  const enabledKeys = () => (enabled ??= enabledModuleKeys(tx));
  // One transaction = one connection: savepoints must not overlap, so metrics run one after another.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  return {
    async list(opts = {}) {
      const deps = gate();
      const perms = await permsOf(opts.as);
      const on = await enabledKeys();
      const out: MetricInfo[] = [];
      const ok = (p: string) => !!opts.all || hasPermission(perms, p);
      for (const [k, s] of Object.entries(CORE_METRICS)) if (ok(s.permission)) out.push(info(k, "core", s, ""));
      for (const m of deps.registry.all()) {
        if (!on.has(m.manifest.key)) continue;
        for (const [k, s] of Object.entries(m.metrics ?? {})) {
          if (ok(s.permission)) out.push(info(k, m.manifest.key, s, `/m/${m.manifest.key}`));
        }
      }
      return out;
    },

    async get(key, range, opts = {}): Promise<MetricResult> {
      const deps = gate();
      const perms = await permsOf(opts.as);
      const core = CORE_METRICS[key];
      const moduleKey = key.split(".")[0]!;
      const def = core ? undefined : deps.registry.get(moduleKey);
      const spec = core ?? def?.metrics?.[key];
      if (!spec) throw notFound("Metric");
      if (!hasPermission(perms, spec.permission)) throw forbidden(`Missing permission ${spec.permission}`);
      // A savepoint per metric: one broken query must not abort the caller's transaction.
      try {
        return await serial(() => tx.transaction(async (sp) => {
          if (core) return normalise(await core.compute(sp, range));
          const loaded = await loadEnabledModule(sp, deps, base.tenantId, moduleKey);
          if (!loaded) throw notFound("Metric");
          const asCtx: RequestContext = { ...base, actor: { ...base.actor, permissions: perms } };
          return normalise(await spec.compute(createModuleContext(sp, asCtx, loaded.def, loaded.state, undefined, deps) as never, range));
        }));
      } catch (e) {
        if ((e as { statusCode?: number }).statusCode === 404) throw e;
        console.error(JSON.stringify({ lvl: "error", msg: "metric failed", key, err: String((e as Error)?.message ?? e).slice(0, 300) }));
        return { value: null, error: "This number couldn't be worked out." };
      }
    },
  };
}
