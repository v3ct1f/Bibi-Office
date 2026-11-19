import { outbox, uuidv7, type Tx } from "@office/db";
import { badRequest } from "./errors.ts";
import type { RequestContext } from "./context.ts";

export const MAX_EVENT_DEPTH = 8;
const TYPE_RE = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export interface OfficeEvent<P = unknown> {
  id: string;
  tenantId: string;
  type: string;
  version: number;
  payload: P;
  actor: { type: string; id: string | null };
  causationId: string | null;
  correlationId: string;
  depth: number;
  occurredAt: string;
}

/**
 * Write an event to the outbox inside the caller's transaction.
 * Published by the worker only if the business change commits.
 */
export async function emitEvent(
  tx: Tx, ctx: RequestContext, type: string, payload: unknown, version = 1,
): Promise<string> {
  if (!TYPE_RE.test(type)) throw badRequest(`Invalid event type ${type}`);
  const depth = (ctx.causation?.depth ?? -1) + 1;
  if (depth > MAX_EVENT_DEPTH) throw badRequest("Event chain too deep (possible workflow loop)");
  const id = uuidv7();
  await tx.insert(outbox).values({
    id,
    tenantId: ctx.tenantId,
    type,
    version,
    payload,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "user" || ctx.actor.type === "api_key" ? ctx.actor.id : null,
    causationId: ctx.causation?.id ?? null,
    correlationId: ctx.causation?.correlationId ?? id,
    depth,
  });
  return id;
}
