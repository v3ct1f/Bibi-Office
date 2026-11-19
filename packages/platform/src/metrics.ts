// KPI metrics published by modules (ModuleDefinition.metrics), computed on request for the caller's tenant.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { badRequest, hasPermission, type RequestContext } from "@office/core";
import { tenantModules, type Tx } from "@office/db";
import { ModuleError, type Logger, type MetricBucket, type MetricRange, type MetricSpec, type MetricValue } from "@office/sdk";
import { createModuleContext } from "./context.ts";
import { loadEnabledModule, type ModuleDeps } from "./tenant-modules.ts";
import { inModuleRole } from "./module-role.ts";

const DAY = 86_400_000;
const MAX_DAYS = 1100;   // ~3 years
const iso = (d: Date) => d.toISOString().slice(0, 10);
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date");

export const MetricQuery = z.object({
  keys: z.string().max(2000).transform((s) => [...new Set(s.split(",").map((k) => k.trim()).filter(Boolean))])
    .pipe(z.array(z.string().regex(/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9_]{0,40}$/)).min(1).max(30)),
  from: Ymd, to: Ymd,
  bucket: z.enum(["day", "week", "month"]).optional(),
  compare: z.stringbool().default(true),
});

/** Build a range from inclusive YYYY-MM-DD dates. Bucket defaults by length: ≤31 days → day, ≤190 → week, else month. */
export function metricRange(fromDate: string, toDate: string, bucket?: MetricBucket): MetricRange {
  const from = new Date(`${fromDate}T00:00:00Z`), last = new Date(`${toDate}T00:00:00Z`);
  const days = Math.round((last.getTime() - from.getTime()) / DAY) + 1;
  if (days < 1) throw badRequest("The end date must be on or after the start date");
  if (days > MAX_DAYS) throw badRequest("Pick a range of at most 3 years");
  const b = bucket ?? (days <= 31 ? "day" : days <= 190 ? "week" : "month");
  if (b === "day" && days > 400) throw badRequest("Daily points are limited to about a year; pick weeks or months");
  return { from, to: new Date(last.getTime() + DAY), fromDate, toDate, bucket: b };
}

/** The range of the same length just before this one. */
export function previousRange(r: MetricRange): MetricRange {
  const len = r.to.getTime() - r.from.getTime();
  const to = r.from, from = new Date(to.getTime() - len);
  return { from, to, fromDate: iso(from), toDate: iso(new Date(to.getTime() - DAY)), bucket: r.bucket };
}

/** Bucket starts covering the range (Postgres date_trunc semantics: weeks start Monday). */
export function bucketStarts(r: MetricRange): string[] {
  const start = new Date(r.from);
  if (r.bucket === "week") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (r.bucket === "month") start.setUTCDate(1);
  const out: string[] = [];
  for (const d = start; d < r.to; ) {
    out.push(iso(d));
    if (r.bucket === "day") d.setUTCDate(d.getUTCDate() + 1);
    else if (r.bucket === "week") d.setUTCDate(d.getUTCDate() + 7);
    else d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

/** Fill the module's series to one point per bucket (only when the module returned one: rates and medians don't). */
const fill = (r: MetricRange, s: NonNullable<MetricValue["series"]>) => {
  const m = new Map(s.map((p) => [p.t.slice(0, 10), p.v]));
  return bucketStarts(r).map((t) => ({ t, v: Number(m.get(t) ?? 0) }));
};

export interface MetricInfo { key: string; module: string; moduleName: string; label: string; description: string | null; unit: MetricSpec["unit"]; kind: MetricSpec["kind"]; lowerIsBetter: boolean }

async function enabledKeys(tx: Tx) {
  return new Set((await tx.select({ k: tenantModules.moduleKey }).from(tenantModules).where(eq(tenantModules.enabled, true))).map((r) => r.k));
}

/** Metrics of enabled modules that the caller may see. */
export async function metricCatalog(tx: Tx, ctx: RequestContext, d: ModuleDeps): Promise<MetricInfo[]> {
  const on = await enabledKeys(tx);
  return d.registry.all().filter((m) => on.has(m.manifest.key)).flatMap((m) =>
    Object.entries(m.metrics ?? {}).filter(([, s]) => hasPermission(ctx.actor.permissions, s.permission)).map(([key, s]) => ({
      key, module: m.manifest.key, moduleName: m.manifest.name, label: s.label, description: s.description ?? null,
      unit: s.unit, kind: s.kind, lowerIsBetter: !!s.lowerIsBetter,
    })));
}

export type MetricResult =
  | (MetricInfo & { ok: true; value: number | null; previous: number | null; currency: string | null; excluded: number; series: { t: string; v: number }[] | null })
  | { key: string; ok: false; error: "unavailable" | "failed"; message: string };

/**
 * Compute several metrics. Each runs in its own savepoint, so one failing metric (or a missing permission,
 * or a disabled module) is reported per key and doesn't break the others.
 */
export async function computeMetrics(tx: Tx, ctx: RequestContext, d: ModuleDeps, q: z.infer<typeof MetricQuery>, log?: Logger): Promise<{ range: MetricRange; previous: MetricRange; results: MetricResult[] }> {
  const range = metricRange(q.from, q.to, q.bucket), prev = previousRange(range);
  const results: MetricResult[] = [];
  for (const key of q.keys) {
    const modKey = key.split(".")[0]!;
    const spec = d.registry.get(modKey)?.metrics?.[key];
    const unavailable = (message: string) => results.push({ key, ok: false, error: "unavailable", message });
    if (!spec) { unavailable("Unknown metric"); continue; }
    if (!hasPermission(ctx.actor.permissions, spec.permission)) { unavailable("You don't have access to this metric"); continue; }
    try {
      const r = await tx.transaction(async (sp) => {
        const loaded = await loadEnabledModule(sp, d, ctx.tenantId, modKey);
        if (!loaded) return null;
        const mctx = createModuleContext(sp, ctx, loaded.def, loaded.state, log);
        const [now, before] = await inModuleRole(sp, modKey, async () => [
          await spec.compute(mctx, range),
          spec.kind === "flow" && q.compare ? await spec.compute(mctx, prev) : null,
        ] as const);
        return { now, before, moduleName: loaded.def.manifest.name };
      });
      if (!r) { unavailable("The module is turned off"); continue; }
      const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
      results.push({
        key, ok: true, module: modKey, moduleName: r.moduleName, label: spec.label, description: spec.description ?? null, unit: spec.unit, kind: spec.kind, lowerIsBetter: !!spec.lowerIsBetter,
        value: num(r.now.value), previous: r.before ? num(r.before.value) : null, currency: r.now.currency ?? null, excluded: r.now.excluded ?? 0,
        series: spec.kind === "flow" && r.now.series ? fill(range, r.now.series) : null,
      });
    } catch (e) {
      if (e instanceof ModuleError) { results.push({ key, ok: false, error: "failed", message: e.message }); continue; }
      log?.error({ err: e, metric: key }, "metric failed");
      results.push({ key, ok: false, error: "failed", message: "This metric couldn't be calculated" });
    }
  }
  return { range, previous: prev, results };
}
