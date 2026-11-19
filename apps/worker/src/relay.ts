import type postgres from "postgres";

export interface OutboxRow {
  id: string; tenant_id: string; type: string; version: number; payload: unknown;
  actor_type: string | null; actor_id: string | null; causation_id: string | null;
  correlation_id: string | null; depth: number; occurred_at: Date; attempts: number;
}

/** Publisher abstraction: NATS JetStream in prod, in-memory in tests. msgId enables broker-side dedupe. */
export interface Publisher { publish(subject: string, data: Uint8Array, msgId: string): Promise<void> }

/** Subject: office.<tenantId>.<module>.<entity>.<verb> — consumers filter by tenant or type. */
export const subjectFor = (r: Pick<OutboxRow, "tenant_id" | "type">) => `office.${r.tenant_id}.${r.type}`;

export function toEnvelope(r: OutboxRow) {
  return {
    id: r.id, tenantId: r.tenant_id, type: r.type, version: r.version, payload: r.payload,
    actor: { type: r.actor_type, id: r.actor_id }, causationId: r.causation_id,
    correlationId: r.correlation_id ?? r.id, depth: r.depth, occurredAt: r.occurred_at.toISOString(),
  };
}

/**
 * Publish one batch. Rows locked with SKIP LOCKED so N relays can run in parallel.
 * At-least-once: a crash after publish but before commit re-sends; JetStream dedupes by msgId.
 */
export async function relayBatch(sql: postgres.Sql, pub: Publisher, batchSize = 100, maxAttempts = 20): Promise<number> {
  return sql.begin(async (tx) => {
    const rows = await tx<OutboxRow[]>`
      select id, tenant_id, type, version, payload, actor_type, actor_id, causation_id, correlation_id,
             depth, occurred_at, attempts
      from outbox
      where published_at is null and attempts < ${maxAttempts}
      order by id
      limit ${batchSize}
      for update skip locked`;
    const enc = new TextEncoder();
    for (const r of rows) {
      try {
        await pub.publish(subjectFor(r), enc.encode(JSON.stringify(toEnvelope(r))), r.id);
        await tx`update outbox set published_at = now(), attempts = attempts + 1, last_error = null where id = ${r.id}`;
      } catch (e) {
        await tx`update outbox set attempts = attempts + 1, last_error = ${String(e).slice(0, 500)} where id = ${r.id}`;
      }
    }
    return rows.length;
  });
}
