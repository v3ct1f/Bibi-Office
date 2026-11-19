import { auditLog, uuidv7, type Tx } from "@office/db";
import { sql } from "drizzle-orm";
import type { RequestContext } from "./context.ts";

/** Append to the tenant's audit chain (seq/hash filled by DB trigger). */
export async function audit(
  tx: Tx, ctx: RequestContext, action: string,
  entity?: { type: string; id: string }, diff?: unknown,
): Promise<void> {
  await tx.insert(auditLog).values({
    id: uuidv7(),
    tenantId: ctx.tenantId,
    seq: 0,                       // overwritten by trigger
    actorType: ctx.actor.type,
    actorId: ctx.actor.id,
    action,
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
    diff: diff ?? null,
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    requestId: ctx.requestId,
    hash: Buffer.alloc(0),       // overwritten by trigger
  });
}

/** Returns first broken seq or null if the tenant's chain is intact. */
export async function verifyAuditChain(tx: Tx): Promise<number | null> {
  const rows = await tx.execute<{ bad: string | null }>(sql`select audit_verify() as bad`);
  const bad = rows[0]?.bad;
  return bad == null ? null : Number(bad);
}

/** Field-level diff for updates; secrets never reach here (DTOs exclude them). */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (k === "updatedAt") continue;
    const a = before[k], b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}
