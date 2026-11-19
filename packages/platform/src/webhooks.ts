import { and, desc, eq } from "drizzle-orm";
import { createHmac, randomBytes } from "node:crypto";
import type postgres from "postgres";
import { request } from "undici";
import { z } from "zod";
import { audit, badRequest, notFound, requirePermission, type RequestContext } from "@office/core";
import { uuidv7, webhookDeliveries, webhookEndpoints, type Tx } from "@office/db";
import type { EventEnvelope } from "@office/sdk";
import type { SecretBox } from "./crypto.ts";
import { assertUrlAllowed, guardedAgent } from "./ssrf.ts";

export const EVENT_PATTERN = /^(\*|[a-z][a-z0-9-]*\.\*|[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.\*|[a-z][a-z0-9-]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/;

export const WebhookInput = z.object({
  url: z.string().url().max(2048),
  description: z.string().max(500).nullish(),
  events: z.array(z.string().regex(EVENT_PATTERN, "event type, 'module.*', 'module.entity.*' or '*'")).min(1).max(100),
  active: z.boolean().default(true),
}).strict();

export function eventMatches(patterns: string[], type: string): boolean {
  return patterns.some((p) => p === "*" || p === type || (p.endsWith(".*") && type.startsWith(p.slice(0, -1))));
}

/** Stripe-style signature: "t=<unix>,v1=<hex hmac_sha256(secret, `${t}.${body}`)>". */
export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export interface WebhookDeps { secrets: SecretBox; requireHttps: boolean }

const view = ({ tenantId: _t, secretEnc: _s, ...r }: typeof webhookEndpoints.$inferSelect) => r;

export const webhookService = (d: WebhookDeps) => ({
  async list(tx: Tx, ctx: RequestContext) {
    requirePermission(ctx, "core:webhooks.manage");
    return (await tx.select().from(webhookEndpoints).orderBy(desc(webhookEndpoints.id))).map(view);
  },
  async create(tx: Tx, ctx: RequestContext, input: z.infer<typeof WebhookInput>) {
    requirePermission(ctx, "core:webhooks.manage");
    try { assertUrlAllowed(input.url, { requireHttps: d.requireHttps }); } catch (e) { throw badRequest((e as Error).message); }
    const id = uuidv7();
    const secret = `whsec_${randomBytes(24).toString("base64url")}`;
    const [w] = await tx.insert(webhookEndpoints).values({
      id, tenantId: ctx.tenantId, url: input.url, description: input.description ?? null, events: input.events,
      active: input.active, secretEnc: d.secrets.seal(secret, ctx.tenantId), createdBy: ctx.actor.userId ?? null,
    }).returning();
    await audit(tx, ctx, "webhook.created", { type: "webhook", id }, { url: input.url, events: input.events });
    return { ...view(w!), secret };
  },
  async update(tx: Tx, ctx: RequestContext, id: string, input: z.infer<typeof WebhookInput>) {
    requirePermission(ctx, "core:webhooks.manage");
    try { assertUrlAllowed(input.url, { requireHttps: d.requireHttps }); } catch (e) { throw badRequest((e as Error).message); }
    const [w] = await tx.update(webhookEndpoints).set({
      url: input.url, description: input.description ?? null, events: input.events, active: input.active,
      ...(input.active ? { failureStreak: 0 } : {}),
    }).where(eq(webhookEndpoints.id, id)).returning();
    if (!w) throw notFound("Webhook");
    await audit(tx, ctx, "webhook.updated", { type: "webhook", id }, input);
    return view(w);
  },
  async remove(tx: Tx, ctx: RequestContext, id: string) {
    requirePermission(ctx, "core:webhooks.manage");
    const r = await tx.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id)).returning({ id: webhookEndpoints.id });
    if (!r.length) throw notFound("Webhook");
    await audit(tx, ctx, "webhook.deleted", { type: "webhook", id });
  },
  async deliveries(tx: Tx, ctx: RequestContext, id: string, limit: number) {
    requirePermission(ctx, "core:webhooks.manage");
    return (await tx.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, id))
      .orderBy(desc(webhookDeliveries.id)).limit(limit)).map(({ tenantId: _t, body: _b, ...r }) => r);
  },
  /** Re-queue a failed delivery now. */
  async redeliver(tx: Tx, ctx: RequestContext, endpointId: string, deliveryId: string) {
    requirePermission(ctx, "core:webhooks.manage");
    const r = await tx.update(webhookDeliveries).set({ status: "pending", nextAttemptAt: new Date() })
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.endpointId, endpointId))).returning({ id: webhookDeliveries.id });
    if (!r.length) throw notFound("Delivery");
    await audit(tx, ctx, "webhook.redelivered", { type: "webhook", id: endpointId }, { deliveryId });
  },
});

/** Dispatcher step (tenant tx): queue one delivery per matching active endpoint. */
export async function enqueueDeliveries(tx: Tx, event: EventEnvelope): Promise<number> {
  const eps = await tx.select({ id: webhookEndpoints.id, events: webhookEndpoints.events })
    .from(webhookEndpoints).where(eq(webhookEndpoints.active, true));
  const matching = eps.filter((e) => eventMatches(e.events, event.type));
  if (!matching.length) return 0;
  await tx.insert(webhookDeliveries).values(matching.map((e) => ({
    id: uuidv7(), tenantId: event.tenantId, endpointId: e.id, eventId: event.id, eventType: event.type, body: event,
  }))).onConflictDoNothing();
  return matching.length;
}

export const MAX_ATTEMPTS = 12;          // ~1.5 days with backoff below
export const DISABLE_AFTER_FAILURES = 50; // consecutive failed deliveries => endpoint auto-disabled
const backoffSec = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 6 * 3600);

/**
 * Delivery worker (office_relay role; cross-tenant). Claims due rows with a short lease
 * (SKIP LOCKED, no tx held during HTTP), so many workers can run in parallel.
 * At-least-once: receivers dedupe on Office-Event-Id.
 */
export async function deliverDue(
  db: postgres.Sql, secrets: SecretBox, o: { allowPrivate: boolean; requireHttps: boolean; batch?: number; leaseSec?: number },
): Promise<number> {
  const rows = await db<{ id: string; tenant_id: string; endpoint_id: string; event_id: string; event_type: string; body: unknown; attempts: number; url: string; secret_enc: Buffer }[]>`
    with due as (
      select d.id from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
      where d.status = 'pending' and d.next_attempt_at <= now() and e.active
      order by d.next_attempt_at limit ${o.batch ?? 50}
      for update of d skip locked
    )
    update webhook_deliveries d set next_attempt_at = now() + make_interval(secs => ${o.leaseSec ?? 120})
    from due, webhook_endpoints e
    where d.id = due.id and e.id = d.endpoint_id
    returning d.id, d.tenant_id, d.endpoint_id, d.event_id, d.event_type, d.body, d.attempts, e.url, e.secret_enc`;
  const agent = guardedAgent({ allowPrivate: o.allowPrivate });
  try {
    await Promise.all(rows.map(async (r) => {
      const attempt = r.attempts + 1;
      let code: number | null = null, err: string | null = null;
      try {
        assertUrlAllowed(r.url, { requireHttps: o.requireHttps, allowPrivate: o.allowPrivate });
        const body = JSON.stringify(r.body);
        const res = await request(r.url, {
          method: "POST", dispatcher: agent, body,
          headers: {
            "content-type": "application/json", "user-agent": "Office-Webhooks/1",
            "office-event-id": r.event_id, "office-event-type": r.event_type,
            "office-signature": sign(secrets.open(r.secret_enc, r.tenant_id), body),
          },
        });
        code = res.statusCode;
        await res.body.dump();
        if (code < 200 || code >= 300) err = `HTTP ${code}`;
      } catch (e) {
        err = String((e as Error).message ?? e).slice(0, 500);
      }
      await db.begin(async (tx) => {
        if (!err) {
          await tx`update webhook_deliveries set status = 'delivered', attempts = ${attempt}, status_code = ${code},
                   last_error = null, delivered_at = now() where id = ${r.id}`;
          await tx`update webhook_endpoints set failure_streak = 0 where id = ${r.endpoint_id}`;
        } else {
          const final = attempt >= MAX_ATTEMPTS;
          await tx`update webhook_deliveries set status = ${final ? "failed" : "pending"}, attempts = ${attempt},
                   status_code = ${code}, last_error = ${err},
                   next_attempt_at = now() + make_interval(secs => ${backoffSec(attempt)}) where id = ${r.id}`;
          await tx`update webhook_endpoints set failure_streak = failure_streak + 1,
                   active = (failure_streak + 1) < ${DISABLE_AFTER_FAILURES} where id = ${r.endpoint_id}`;
        }
      });
    }));
  } finally {
    await agent.close();
  }
  return rows.length;
}
