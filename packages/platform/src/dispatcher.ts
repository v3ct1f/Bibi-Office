import { eventConsumptions, withTenant, type Db, type Tx } from "@office/db";
import type { EventEnvelope } from "@office/sdk";
import { createModuleContext, systemContext } from "./context.ts";
import { enabledModuleKeys, loadEnabledModule, type ModuleDeps } from "./tenant-modules.ts";
import { matchWorkflows, type RunRef } from "./workflows/engine.ts";
import type { WorkflowRunner } from "./workflows/runners.ts";
import { enqueueDeliveries } from "./webhooks.ts";

export interface DispatchDeps extends ModuleDeps { db: Db; runner: WorkflowRunner }

/** Claim (tenant, event, consumer) once. Returns false if already consumed. */
async function claim(tx: Tx, e: EventEnvelope, consumer: string) {
  const r = await tx.insert(eventConsumptions).values({ tenantId: e.tenantId, eventId: e.id, consumer })
    .onConflictDoNothing().returning({ c: eventConsumptions.consumer });
  return r.length > 0;
}

/**
 * Fan an event out to: module handlers, workflow matcher, webhook queue.
 * Each consumer runs in its own tenant tx together with its dedupe row => effectively-once per consumer.
 * A failing consumer throws after the others ran; the message is redelivered and finished consumers skip.
 */
export async function dispatchEvent(d: DispatchDeps, e: EventEnvelope): Promise<{ handlers: string[]; runs: RunRef[]; webhooks: number }> {
  const errors: unknown[] = [];
  const handlers: string[] = [];
  const causation = { id: e.id, correlationId: e.correlationId, depth: e.depth };

  const enabled = await withTenant(d.db, e.tenantId, (tx) => enabledModuleKeys(tx));
  for (const m of d.registry.subscribers(e.type)) {
    const key = m.manifest.key;
    if (!enabled.has(key)) continue;
    try {
      await withTenant(d.db, e.tenantId, async (tx) => {
        if (!(await claim(tx, e, `module:${key}`))) return;
        const loaded = await loadEnabledModule(tx, d, e.tenantId, key);
        if (!loaded) return;
        const ctx = systemContext(e.tenantId, `event:${e.id}`, `module:${key}`, causation);
        ctx.actor = { type: "module", id: key, permissions: new Set(["*"]) };
        await m.handlers![e.type]!(createModuleContext(tx, ctx, loaded.def, loaded.state, undefined, d), e);
        handlers.push(key);
      });
    } catch (err) { errors.push(err); }
  }

  let runs: RunRef[] = [];
  try {
    runs = await withTenant(d.db, e.tenantId, async (tx) => ((await claim(tx, e, "workflows")) ? matchWorkflows(tx, e) : []));
  } catch (err) { errors.push(err); }
  // Start after commit. If the process dies here, stalePendingRuns() picks them up.
  for (const r of runs) await d.runner.start(r).catch((err) => errors.push(err));

  let webhooks = 0;
  try {
    webhooks = await withTenant(d.db, e.tenantId, async (tx) => ((await claim(tx, e, "webhooks")) ? enqueueDeliveries(tx, e) : 0));
  } catch (err) { errors.push(err); }

  if (errors.length) throw new AggregateError(errors, `dispatch of ${e.type} ${e.id} had ${errors.length} error(s)`);
  return { handlers, runs, webhooks };
}
