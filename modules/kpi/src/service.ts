import { and, asc, count, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import {
  isTimeZone, METRIC_UNITS, metricRange, moduleErrors as E, startOfDay, todayIn,
  type MetricGroup, type MetricResult, type MetricUnit, type ModuleContext,
} from "@office/sdk";
import { compose, MailError, send, type Security, type Smtp } from "./mail.ts";
import { compareRange, elapsed, isDate, periodOf, series, SERIES_LENGTH, shift, addDays, type Period } from "./periods.ts";
import { boards, CHARTS, COMPARE, manualMetrics, manualValues, PERIODS, targets, tiles, type Compare, type PeriodKind } from "./schema.ts";

export const P = {
  READ: "kpi:board.read",
  MANAGE: "kpi:board.manage",       // boards, tiles, targets, manual KPIs, the email digest
  VALUES: "kpi:values.write",       // type in values of manual KPIs
} as const;

// ───────── Settings ─────────
interface Settings {
  timeZone?: string; fromAddress?: string; fromName?: string; smtpHost?: string; smtpPort?: number; smtpSecurity?: string; smtpUser?: string;
}
const settingsOf = (ctx: ModuleContext) => ctx.settings.get<Settings>();
export const tzOf = (ctx: ModuleContext) => { const tz = settingsOf(ctx).timeZone; return tz && isTimeZone(tz) ? tz : "UTC"; };
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
const can = (ctx: ModuleContext, p: string) => ctx.authz.can(p);

export function smtpOf(ctx: ModuleContext): { smtp: Smtp | null; missing: string[] } {
  const s = settingsOf(ctx);
  const missing = [...(!s.smtpHost ? ["Outgoing mail server"] : []), ...(!s.fromAddress ? ["Send from address"] : [])];
  if (missing.length) return { smtp: null, missing };
  const security: Security = s.smtpSecurity === "starttls" || s.smtpSecurity === "none" ? s.smtpSecurity : "tls";
  return {
    missing: [],
    smtp: {
      host: s.smtpHost!, port: s.smtpPort ?? (security === "tls" ? 465 : 587), security,
      user: s.smtpUser ?? "", pass: ctx.secrets.get("smtpPassword") ?? "", from: s.fromAddress!, fromName: s.fromName || "KPI dashboard",
    },
  };
}

// ───────── Catalogue: every number a board can show ─────────
export interface Metric {
  key: string; label: string; description: string; group: MetricGroup; unit: MetricUnit; kind: "total" | "snapshot"; better: "up" | "down";
  link: string | null; source: "module" | "manual" | "derived"; module: string; currency: string | null;
}
const PROFIT = "kpi.profit";
const MANUAL = "manual.";
const PROFIT_PARTS = ["invoicing.revenue", "expenses.spent_net"] as const;

export async function catalogue(ctx: ModuleContext, as?: string): Promise<Metric[]> {
  const fromModules: Metric[] = (await ctx.metrics.list(as ? { as } : {})).map((m) => ({ ...m, source: "module" as const, currency: null }));
  const keys = new Set(fromModules.map((m) => m.key));
  const derived: Metric[] = PROFIT_PARTS.every((k) => keys.has(k)) ? [{
    key: PROFIT, label: "Profit (estimate)", description: "Revenue before tax minus approved expenses before tax. Pay and stock aren't included.",
    group: "money", unit: "money", kind: "total", better: "up", link: null, source: "derived", module: "kpi", currency: null,
  }] : [];
  const manual: Metric[] = (await ctx.db.select().from(manualMetrics).orderBy(asc(manualMetrics.name))).map((m) => ({
    key: `${MANUAL}${m.id}`, label: m.name, description: m.description ?? "Typed in by hand.", group: "other", unit: m.unit, kind: m.kind,
    better: m.better, link: `/m/kpi/kpi/manual/${m.id}`, source: "manual", module: "kpi", currency: m.currency,
  }));
  return [...fromModules, ...derived, ...manual];
}

type Values = Map<string, Promise<MetricResult>>;
interface Calc { ctx: ModuleContext; tz: string; as: string | undefined; cache: Values }
const calc = (ctx: ModuleContext, as?: string): Calc => ({ ctx, tz: tzOf(ctx), as, cache: new Map() });

/** One number for [from, to). Cached per request, so series and comparisons don't repeat work. */
function valueOf(c: Calc, m: Metric, from: string, to: string): Promise<MetricResult> {
  const k = `${m.key}|${from}|${to}`;
  let v = c.cache.get(k);
  if (!v) { v = compute(c, m, from, to); c.cache.set(k, v); }
  return v;
}

async function compute(c: Calc, m: Metric, from: string, to: string): Promise<MetricResult> {
  if (m.source === "module") return c.ctx.metrics.get(m.key, metricRange(from, to, c.tz), c.as ? { as: c.as } : {});
  if (m.source === "derived") {
    const [rev, exp] = await Promise.all(PROFIT_PARTS.map((key) => c.ctx.metrics.get(key, metricRange(from, to, c.tz), c.as ? { as: c.as } : {})));
    if (rev!.value == null || exp!.value == null) return { value: null };
    if (rev!.currency !== exp!.currency) return { value: null, error: "Invoicing and Expenses use different currencies." };
    return { value: Math.round((rev!.value - exp!.value) * 100) / 100, currency: rev!.currency };
  }
  const id = m.key.slice(MANUAL.length);
  const q = m.kind === "total"
    ? sql`select sum(value) as n, count(*) as c from kpi_manual_values where metric_id = ${id} and on_date >= ${from} and on_date < ${to}`
    : sql`select value as n, 1 as c from kpi_manual_values where metric_id = ${id} and on_date < ${to} order by on_date desc limit 1`;
  const [r] = await c.ctx.db.execute<{ n: string | null; c: string }>(q) as unknown as { n: string | null; c: string }[];
  return { value: r && Number(r.c) > 0 && r.n != null ? Number(r.n) : null, currency: m.currency ?? undefined };
}

// ───────── Targets ─────────
export type Status = "met" | "on_track" | "behind" | "missed";
export function targetStatus(m: Pick<Metric, "kind" | "better">, value: number, target: number, fraction: number, finished: boolean): Status {
  const up = m.better === "up";
  if (m.kind === "snapshot" || finished) return (up ? value >= target : value <= target) ? "met" : finished ? "missed" : "behind";
  if (up) return value >= target ? "met" : value >= target * fraction ? "on_track" : "behind";
  if (value > target) return "missed";
  return value <= target * fraction ? "on_track" : "behind";
}

const MetricKey = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z0-9_-]{1,60}$/, "Unknown number");
export const TargetInput = z.object({ metricKey: MetricKey, period: z.enum(PERIODS), value: z.number().finite().min(-1e15).max(1e15).nullable() });

export async function listTargets(ctx: ModuleContext) {
  return ctx.db.select({ metricKey: targets.metricKey, period: targets.period, value: targets.value }).from(targets);
}
export async function setTarget(ctx: ModuleContext, input: z.infer<typeof TargetInput>) {
  if (!(await catalogue(ctx)).some((m) => m.key === input.metricKey)) throw E.badRequest("That number isn't available");
  const where = and(eq(targets.metricKey, input.metricKey), eq(targets.period, input.period));
  let id: string | undefined;
  if (input.value === null) id = (await ctx.db.delete(targets).where(where).returning({ id: targets.id }))[0]?.id;
  else {
    [{ id }] = await ctx.db.insert(targets).values({ id: uuidv7(), tenantId: ctx.tenantId, metricKey: input.metricKey, period: input.period, value: input.value, updatedBy: me(ctx) })
      .onConflictDoUpdate({ target: [targets.tenantId, targets.metricKey, targets.period], set: { value: input.value, updatedBy: me(ctx), updatedAt: new Date() } })
      .returning({ id: targets.id }) as [{ id: string }];
  }
  if (id) await ctx.audit.log("target.set", { type: "kpi_target", id }, { metricKey: input.metricKey, period: input.period, value: input.value });
  return { ok: true };
}

// ───────── Boards ─────────
const name = z.string().trim().min(1, "Give it a name").max(80);
const description = z.string().trim().max(300).nullish();
export const BoardInput = z.object({ name, description, suggested: z.boolean().default(false) });
const TileInput = z.object({ metricKey: MetricKey, label: z.string().trim().max(80).nullish(), chart: z.enum(CHARTS).default("bar") });
const appUrl = z.string().trim().max(300).regex(/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?\/t\/[a-z0-9-]+\/m\/kpi\/kpi$/i, "The app address isn't valid");
export const BoardPatch = z.object({
  name: name.optional(), description, period: z.enum(PERIODS).optional(), compare: z.enum(COMPARE).optional(),
  tiles: z.array(TileInput).max(24, "A board can have at most 24 numbers").optional(),
  digest: z.object({
    enabled: z.boolean(), weekday: z.number().int().min(1).max(7), hour: z.number().int().min(0).max(23),
    recipients: z.array(z.uuid()).max(50), appUrl: appUrl.optional(),
  }).optional(),
});

/** Good first numbers, in this order, for a board made "with suggestions". */
const SUGGESTED = [
  "invoicing.revenue", "invoicing.payments_received", "invoicing.unpaid", "expenses.spent", PROFIT, "crm.won_value", "crm.pipeline_value",
  "crm.win_rate", "core.contacts_new", "scheduling.hours_worked", "inventory.low_stock", "support.new_tickets", "support.first_response",
  "support.open_tickets", "core.tasks_overdue",
];

const boardOr404 = async (ctx: ModuleContext, id: string) => {
  const [b] = await ctx.db.select().from(boards).where(eq(boards.id, id));
  if (!b) throw E.notFound("Board");
  return b;
};

export async function listBoards(ctx: ModuleContext) {
  const rows = await ctx.db.select({ id: boards.id, name: boards.name, description: boards.description, period: boards.period, n: count(tiles.id) })
    .from(boards).leftJoin(tiles, eq(tiles.boardId, boards.id)).groupBy(boards.id).orderBy(asc(boards.position), asc(boards.createdAt));
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, period: r.period, tileCount: Number(r.n) }));
}

export async function createBoard(ctx: ModuleContext, input: z.infer<typeof BoardInput>) {
  const id = uuidv7();
  const [pos] = await ctx.db.select({ p: max(boards.position) }).from(boards);
  await ctx.db.insert(boards).values({
    id, tenantId: ctx.tenantId, name: input.name, description: input.description || null, position: (pos?.p ?? -1) + 1,
    period: "month", compare: "previous", digestEnabled: false, digestWeekday: 1, digestHour: 8, digestRecipients: [], createdBy: me(ctx),
  });
  if (input.suggested) {
    const have = new Set((await catalogue(ctx)).map((m) => m.key));
    const keys = SUGGESTED.filter((k) => have.has(k)).slice(0, 12);
    if (keys.length) {
      await ctx.db.insert(tiles).values(keys.map((metricKey, position) => ({ id: uuidv7(), tenantId: ctx.tenantId, boardId: id, position, metricKey, chart: "bar" as const })));
    }
  }
  await ctx.audit.log("board.created", { type: "kpi_board", id }, { name: input.name });
  return getBoard(ctx, id);
}

export async function getBoard(ctx: ModuleContext, id: string) {
  const b = await boardOr404(ctx, id);
  const ts = await ctx.db.select().from(tiles).where(eq(tiles.boardId, id)).orderBy(asc(tiles.position));
  const manage = can(ctx, P.MANAGE);
  let digest = null;
  if (manage) {
    const people = await ctx.people.list();
    digest = {
      enabled: b.digestEnabled, weekday: b.digestWeekday, hour: b.digestHour, lastSentAt: b.digestLastSentAt, lastError: b.digestLastError,
      recipients: b.digestRecipients.map((u) => { const p = people.find((x) => x.userId === u); return { userId: u, name: p?.name ?? "Former member", email: p?.email ?? null }; }),
    };
  }
  return {
    id: b.id, name: b.name, description: b.description, period: b.period, compare: b.compare, canManage: manage,
    tiles: ts.map((t) => ({ id: t.id, metricKey: t.metricKey, label: t.label, chart: t.chart })), digest,
  };
}

export async function updateBoard(ctx: ModuleContext, id: string, p: z.infer<typeof BoardPatch>) {
  await boardOr404(ctx, id);
  const set: Partial<typeof boards.$inferInsert> = { updatedAt: new Date() };
  if (p.name !== undefined) set.name = p.name;
  if (p.description !== undefined) set.description = p.description || null;
  if (p.period) set.period = p.period;
  if (p.compare) set.compare = p.compare;
  if (p.digest) {
    const people = await ctx.people.list();
    const unknown = p.digest.recipients.filter((u) => !people.some((x) => x.userId === u));
    if (unknown.length) throw E.badRequest("Choose recipients from your team");
    if (p.digest.enabled && !p.digest.recipients.length) throw E.badRequest("Choose at least one person to send the email to");
    Object.assign(set, {
      digestEnabled: p.digest.enabled, digestWeekday: p.digest.weekday, digestHour: p.digest.hour, digestRecipients: [...new Set(p.digest.recipients)],
      ...(p.digest.appUrl ? { appUrl: p.digest.appUrl } : {}),
    });
  }
  await ctx.db.update(boards).set(set).where(eq(boards.id, id));
  if (p.tiles) {
    await ctx.db.delete(tiles).where(eq(tiles.boardId, id));
    if (p.tiles.length) {
      await ctx.db.insert(tiles).values(p.tiles.map((t, position) => ({
        id: uuidv7(), tenantId: ctx.tenantId, boardId: id, position, metricKey: t.metricKey, label: t.label || null, chart: t.chart,
      })));
    }
  }
  await ctx.audit.log("board.updated", { type: "kpi_board", id }, { changed: Object.keys(p) });
  return getBoard(ctx, id);
}

export async function deleteBoard(ctx: ModuleContext, id: string) {
  const b = await boardOr404(ctx, id);
  await ctx.db.delete(boards).where(eq(boards.id, id));
  await ctx.audit.log("board.deleted", { type: "kpi_board", id }, { name: b.name });
}

// ───────── Board values ─────────
const isoDate = z.string().refine(isDate, "Use the format YYYY-MM-DD");
export const ValuesQuery = z.object({
  period: z.enum(PERIODS).optional(), date: isoDate.optional(), compare: z.enum(COMPARE).optional(),
  tiles: z.coerce.number().int().min(1).max(24).optional(), chart: z.enum(["yes", "no"]).optional(),
});

const change = (value: number | null, before: number | null) =>
  value == null || before == null ? null : before === 0 ? (value === 0 ? 0 : null) : ((value - before) / Math.abs(before)) * 100;

/**
 * Every tile's number for one period, with the comparison, the target and (for charts) the trend.
 * `as`: compute as that member (for the email digest), with their permissions.
 */
export async function boardValues(ctx: ModuleContext, id: string, q: z.infer<typeof ValuesQuery>, as?: string) {
  const b = await boardOr404(ctx, id);
  const c = calc(ctx, as);
  const today = todayIn(c.tz);
  const kind: PeriodKind = q.period ?? b.period;
  const compare: Compare = q.compare ?? b.compare;
  const period = periodOf(kind, q.date ?? today);
  const e = elapsed(period, today);
  const finished = today >= period.to;

  const all = await catalogue(ctx, as);
  const byKey = new Map(all.map((m) => [m.key, m]));
  const names = new Map((await ctx.metrics.list({ all: true })).map((m) => [m.key, m.label]));
  const tileRows = (await ctx.db.select().from(tiles).where(eq(tiles.boardId, id)).orderBy(asc(tiles.position))).slice(0, q.tiles ?? 24);
  const goalRows = await ctx.db.select().from(targets).where(eq(targets.period, kind));
  const goals = new Map(goalRows.map((t) => [t.metricKey, t.value]));
  const wantChart = q.chart !== "no";

  const out = await Promise.all(tileRows.map(async (t) => {
    const m = byKey.get(t.metricKey);
    const base = { id: t.id, metricKey: t.metricKey, label: t.label || m?.label || names.get(t.metricKey) || "Number", chart: t.chart };
    if (!m) return { ...base, metric: null, unavailable: "Not available: the feature is off, or you don't have access to it." };
    const cur = await valueOf(c, m, period.from, period.to);
    const cmpRange = compareRange(period, compare, today, m.kind);
    const cmp = cmpRange ? await valueOf(c, m, cmpRange.from, cmpRange.to) : null;
    const pct = cmp ? change(cur.value, cmp.value) : null;
    const goal = goals.get(t.metricKey);
    const target = goal == null || cur.value == null ? (goal == null ? null : { value: goal, progress: null, pace: null, status: null })
      : {
        value: goal, progress: goal === 0 ? null : (cur.value / goal) * 100,
        pace: m.kind === "total" && e.current ? Math.round(goal * e.fraction * 100) / 100 : null,
        status: targetStatus(m, cur.value, goal, e.fraction, finished),
      };
    const points = wantChart && t.chart !== "none"
      ? await Promise.all(series(period, SERIES_LENGTH[kind]).map(async (p) => ({ from: p.from, label: p.short, value: (await valueOf(c, m, p.from, p.to)).value })))
      : [];
    return {
      ...base, metric: m, value: cur.value, currency: cur.currency ?? m.currency ?? null, error: cur.error ?? null,
      compare: cmp && cmpRange ? {
        value: cmp.value, label: cmpRange.label, change: pct == null ? null : Math.round(pct * 10) / 10,
        good: pct == null || pct === 0 ? null : (pct > 0) === (m.better === "up"),
      } : null,
      target, series: points,
    };
  }));
  return {
    board: { id: b.id, name: b.name, period: b.period, compare: b.compare },
    period: { ...period, current: e.current, finished, daysElapsed: e.days, days: e.total },
    previous: shift(period, -1).from, next: finished ? shift(period, 1).from : null,
    compare, tiles: out,
  };
}

// ───────── Manual KPIs ─────────
export const ManualInput = z.object({
  name, description, unit: z.enum(METRIC_UNITS), currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter currency code").nullish(),
  kind: z.enum(["total", "snapshot"]), better: z.enum(["up", "down"]),
}).refine((m) => m.unit !== "money" || !!m.currency, { message: "Choose the currency", path: ["currency"] });
export const ManualPatch = z.object({ name: name.optional(), description, better: z.enum(["up", "down"]).optional() });
export const ManualValueInput = z.object({
  date: isoDate, value: z.number().finite().min(-1e15).max(1e15).nullable(), note: z.string().trim().max(200).nullish(),
});

const manualOr404 = async (ctx: ModuleContext, id: string) => {
  const [m] = await ctx.db.select().from(manualMetrics).where(eq(manualMetrics.id, id));
  if (!m) throw E.notFound("Number");
  return m;
};

export async function listManual(ctx: ModuleContext) {
  const rows = await ctx.db.select().from(manualMetrics).orderBy(asc(manualMetrics.name));
  const last = rows.length ? await ctx.db.execute<{ metric_id: string; on_date: string; value: string; n: string }>(sql`
    select distinct on (metric_id) metric_id, on_date::text, value, count(*) over (partition by metric_id) as n
    from kpi_manual_values order by metric_id, on_date desc`) as unknown as { metric_id: string; on_date: string; value: string; n: string }[] : [];
  return rows.map((m) => {
    const l = last.find((x) => x.metric_id === m.id);
    return { ...dtoManual(m), lastDate: l?.on_date ?? null, lastValue: l ? Number(l.value) : null, valueCount: l ? Number(l.n) : 0 };
  });
}
const dtoManual = (m: typeof manualMetrics.$inferSelect) => ({
  id: m.id, key: `${MANUAL}${m.id}`, name: m.name, description: m.description, unit: m.unit, currency: m.currency, kind: m.kind, better: m.better,
});

export async function createManual(ctx: ModuleContext, input: z.infer<typeof ManualInput>) {
  const id = uuidv7();
  await ctx.db.insert(manualMetrics).values({
    id, tenantId: ctx.tenantId, name: input.name, description: input.description || null, unit: input.unit,
    currency: input.unit === "money" ? input.currency! : null, kind: input.kind, better: input.better, createdBy: me(ctx),
  });
  await ctx.audit.log("manual.created", { type: "kpi_manual", id }, { name: input.name });
  return getManual(ctx, id);
}

export async function getManual(ctx: ModuleContext, id: string) {
  const m = await manualOr404(ctx, id);
  const values = await ctx.db.select({ date: manualValues.onDate, value: manualValues.value, note: manualValues.note })
    .from(manualValues).where(eq(manualValues.metricId, id)).orderBy(desc(manualValues.onDate)).limit(200);
  return { ...dtoManual(m), values, canWrite: can(ctx, P.VALUES), canManage: can(ctx, P.MANAGE) };
}

export async function updateManual(ctx: ModuleContext, id: string, p: z.infer<typeof ManualPatch>) {
  await manualOr404(ctx, id);
  await ctx.db.update(manualMetrics).set({
    ...(p.name !== undefined ? { name: p.name } : {}), ...(p.description !== undefined ? { description: p.description || null } : {}),
    ...(p.better ? { better: p.better } : {}), updatedAt: new Date(),
  }).where(eq(manualMetrics.id, id));
  return getManual(ctx, id);
}

/** Deleting a manual KPI also removes its values, targets and tiles. */
export async function deleteManual(ctx: ModuleContext, id: string) {
  const m = await manualOr404(ctx, id);
  const key = `${MANUAL}${id}`;
  await ctx.db.delete(tiles).where(eq(tiles.metricKey, key));
  await ctx.db.delete(targets).where(eq(targets.metricKey, key));
  await ctx.db.delete(manualMetrics).where(eq(manualMetrics.id, id));
  await ctx.audit.log("manual.deleted", { type: "kpi_manual", id }, { name: m.name });
}

export async function setManualValue(ctx: ModuleContext, id: string, v: z.infer<typeof ManualValueInput>) {
  await manualOr404(ctx, id);
  const where = and(eq(manualValues.metricId, id), eq(manualValues.onDate, v.date));
  if (v.value === null) await ctx.db.delete(manualValues).where(where);
  else {
    await ctx.db.insert(manualValues).values({ id: uuidv7(), tenantId: ctx.tenantId, metricId: id, onDate: v.date, value: v.value, note: v.note || null, createdBy: me(ctx) })
      .onConflictDoUpdate({ target: [manualValues.metricId, manualValues.onDate], set: { value: v.value, note: v.note || null, createdBy: me(ctx) } });
  }
  return getManual(ctx, id);
}

// ───────── Formatting (emails) ─────────
export function formatValue(value: number | null, unit: MetricUnit, currency?: string | null): string {
  if (value == null) return "—";
  const n = (d = 0) => new Intl.NumberFormat("en", { maximumFractionDigits: d }).format(value);
  switch (unit) {
    case "money": return new Intl.NumberFormat("en", { style: "currency", currency: currency || "EUR", maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2 }).format(value);
    case "percent": return `${n(1)}%`;
    case "hours": return `${n(1)} h`;
    case "days": return `${n(1)} ${value === 1 ? "day" : "days"}`;
    case "minutes": return value >= 120 ? `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value / 60)} h` : `${Math.round(value)} min`;
    default: return n(value % 1 ? 1 : 0);
  }
}
const STATUS_TEXT: Record<Status, string> = { met: "target met", on_track: "on track", behind: "behind target", missed: "target missed" };

// ───────── Email digest ─────────
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The email for one person, computed with their own permissions. Null when they can't see the dashboard. */
async function digestFor(ctx: ModuleContext, boardId: string, userId: string) {
  if (!(await ctx.people.can(userId, P.READ))) return null;
  const [b] = await ctx.db.select().from(boards).where(eq(boards.id, boardId));
  if (!b) return null;
  // The period that contains yesterday: on a Monday a weekly board reports last week; a monthly one this month so far.
  const v = await boardValues(ctx, boardId, { date: addDays(todayIn(tzOf(ctx)), -1), chart: "no" }, userId);
  // Numbers this person can't see are left out of their email.
  const lines = v.tiles.flatMap((t) => {
    if (!("value" in t) || !t.metric) return [];
    const parts = [`${t.label}: ${formatValue(t.value ?? null, t.metric.unit, t.currency)}`];
    if (t.compare?.change != null) parts.push(`${t.compare.change > 0 ? "▲" : t.compare.change < 0 ? "▼" : "="} ${Math.abs(t.compare.change)}% vs ${t.compare.label}`);
    if (t.target?.status) parts.push(`${STATUS_TEXT[t.target.status]} (${formatValue(t.target.value, t.metric.unit, t.currency)})`);
    return parts.join(" · ");
  });
  const p = v.period;
  const mail = compose({
    greeting: `Here are the numbers for ${p.label}${p.current ? ` (${p.daysElapsed} of ${p.days} days)` : ""}.`,
    lines: lines.length ? lines : [v.tiles.length ? "None of the numbers on this board are available to you." : "This board has no numbers yet."],
    ...(b.appUrl ? { button: { label: "Open the dashboard", url: `${b.appUrl}?board=${b.id}` } } : {}),
    footer: `You get this every ${WEEKDAYS[b.digestWeekday - 1]} because you're on the "${b.name}" email list.`,
  });
  return { subject: `${b.name}: ${p.label}`, ...mail };
}

/** Sends the board's email to everyone on its list now. */
export async function sendDigest(ctx: ModuleContext, boardId: string) {
  const b = await boardOr404(ctx, boardId);
  const { smtp, missing } = smtpOf(ctx);
  if (!smtp) throw E.conflict(`Set up email first (missing: ${missing.join(", ")})`);
  if (!b.digestRecipients.length) throw E.badRequest("Add people to the email list first");
  const people = await ctx.people.list();
  const sent: string[] = [], skipped: string[] = [], failed: { name: string; error: string }[] = [];
  for (const u of b.digestRecipients) {
    const person = people.find((p) => p.userId === u);
    if (!person) { skipped.push("Former member"); continue; }
    const mail = await digestFor(ctx, boardId, u);
    if (!mail) { skipped.push(person.name); continue; }
    try { await send(smtp, { to: person.email, ...mail }); sent.push(person.name); }
    catch (e) { failed.push({ name: person.name, error: e instanceof MailError ? e.message : "Couldn't send" }); }
  }
  const error = failed.length ? `Not sent to ${failed.map((f) => `${f.name} (${f.error})`).join(", ")}`.slice(0, 500) : null;
  await ctx.db.update(boards).set({ digestLastSentAt: new Date(), digestLastError: error }).where(eq(boards.id, boardId));
  return { sent, skipped, failed };
}

/** Hourly-ish job: sends each board's email once on its weekday, at or after its hour (company time zone). */
export async function digestJob(ctx: ModuleContext) {
  if (!smtpOf(ctx).smtp) return;
  const tz = tzOf(ctx);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.find((p) => p.type === "weekday")!.value) + 1;
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const dayStart = startOfDay(todayIn(tz, now), tz).toISOString();
  const due = await ctx.db.select({ id: boards.id }).from(boards).where(and(
    eq(boards.digestEnabled, true), eq(boards.digestWeekday, weekday), sql`${boards.digestHour} <= ${hour}`,
    sql`(${boards.digestLastSentAt} is null or ${boards.digestLastSentAt} < ${dayStart})`,
  ));
  for (const b of due) {
    try { await sendDigest(ctx, b.id); }
    catch (e) {
      await ctx.db.update(boards).set({ digestLastSentAt: new Date(), digestLastError: String((e as Error).message).slice(0, 500) }).where(eq(boards.id, b.id));
    }
  }
}

export async function testEmail(ctx: ModuleContext) {
  const { smtp, missing } = smtpOf(ctx);
  if (!smtp) throw E.conflict(`Set up email first (missing: ${missing.join(", ")})`);
  const u = me(ctx) ? await ctx.people.get(me(ctx)!) : null;
  if (!u) throw E.badRequest("Only a team member can send a test email");
  try {
    await send(smtp, { to: u.email, subject: "Test email from your KPI dashboard", ...compose({ greeting: `Hi ${u.name},`, lines: ["Email works: weekly KPI emails can be sent from this address."] }) });
  } catch (e) { throw E.badRequest(e instanceof MailError ? e.message : "Couldn't send the email"); }
  return { sentTo: u.email };
}

// ───────── Config ─────────
export async function config(ctx: ModuleContext) {
  const manage = can(ctx, P.MANAGE);
  const mail = smtpOf(ctx);
  return {
    canManage: manage, canWriteValues: can(ctx, P.VALUES), timeZone: tzOf(ctx), today: todayIn(tzOf(ctx)),
    mail: { ready: !!mail.smtp, missing: mail.missing }, catalogue: await catalogue(ctx),
    people: manage ? (await ctx.people.list()).map((p) => ({ userId: p.userId, name: p.name, email: p.email })) : [],
  };
}

export type { Period };
