// Helpers for module metrics (see MetricSpec). Identifiers passed here are module constants, never user input.
import { sql, type SQL } from "drizzle-orm";
import type { MetricRange, MetricValue, ModuleContext } from "./module.ts";

/** Rows from ctx.db.execute (driver-agnostic). */
export const sqlRows = <T>(res: unknown) => (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as T[];

/**
 * `col` within the range, by the company's calendar days (session TimeZone = tenant time zone):
 * date columns compare by day; timestamptz columns from local midnight of fromDate to local midnight after toDate.
 */
export function inRange(col: string, r: MetricRange, isDate = false): SQL {
  return isDate
    ? sql`${sql.raw(col)} >= ${r.fromDate}::date and ${sql.raw(col)} <= ${r.toDate}::date`
    : sql`${sql.raw(col)} >= (${r.fromDate}::date)::timestamptz and ${sql.raw(col)} < (${r.toDate}::date + 1)::timestamptz`;
}

/**
 * Sum `value` (an SQL expression; "1" counts rows) per bucket of `at` over the range.
 * Returns the total and the series; the platform fills empty buckets.
 */
export async function flowSum(ctx: ModuleContext, r: MetricRange, q: { from: string; at: string; value: string; where?: SQL; isDate?: boolean }): Promise<MetricValue> {
  const at = sql.raw(q.at);   // date_trunc on timestamptz uses the session (tenant) time zone
  const rows = sqlRows<{ t: string; v: string | number }>(await ctx.db.execute(sql`
    select date_trunc(${r.bucket}, ${at})::date::text as t, coalesce(sum(${sql.raw(q.value)}), 0) as v
    from ${sql.raw(q.from)}
    where ${inRange(q.at, r, q.isDate)} ${q.where ? sql`and ${q.where}` : sql``}
    group by 1 order by 1`));
  const series = rows.map((x) => ({ t: x.t, v: Number(x.v) }));
  return { value: series.reduce((a, p) => a + p.v, 0), series };
}

/** A single number from a query returning one row with column `v` (null stays null). */
export async function scalar(ctx: ModuleContext, q: SQL): Promise<number | null> {
  const [row] = sqlRows<{ v: string | number | null }>(await ctx.db.execute(q));
  return row?.v === null || row?.v === undefined ? null : Number(row.v);
}
