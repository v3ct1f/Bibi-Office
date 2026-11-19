import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import * as schema from "./schema.ts";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle { db: Db; sql: postgres.Sql; close(): Promise<void> }

export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const client = postgres(url, { max: opts.max ?? 10, prepare: true, onnotice: () => {} });
  return { db: drizzle(client, { schema }), sql: client, close: () => client.end({ timeout: 5 }) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run fn in a transaction bound to one tenant. RLS policies read app.tenant_id,
 * which is transaction-local (SET LOCAL semantics), so pooled connections never leak scope.
 * The session TimeZone is set to the tenant's time zone (settings.timeZone, default UTC) in the same
 * statement, so current_date, date_trunc and date <-> timestamptz casts follow the company's calendar.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error("invalid tenant id");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true),
      set_config('TimeZone', coalesce((select settings->>'timeZone' from tenants where id = ${tenantId}::uuid), 'UTC'), true)`);
    return fn(tx);
  });
}
