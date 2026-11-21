import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import jsonLogic from "json-logic-js";
import { z } from "zod";
import { audit, badRequest, forbidden, hasPermission, notFound, requirePermission, resolveMembership, type RequestContext } from "@office/core";
import {
  memberships, users, uuidv7, withTenant, workflowRuns, workflows, type Db, type StepResult, type Tx, type WorkflowAction,
} from "@office/db";
import type { EventEnvelope } from "@office/sdk";
import type { ModuleRegistry } from "../registry.ts";
import type { ModuleDeps } from "../tenant-modules.ts";
import { systemContext } from "../context.ts";
import { actionExists, actionPermissions, executeAction, type HttpOptions } from "./actions.ts";
import { render } from "./template.ts";

// ───────── Definitions ─────────
const CORE_ENTITY_EVENTS = ["contact", "company", "document", "task"]
  .flatMap((e) => ["created", "updated", "deleted"].map((v) => `core.${e}.${v}`));
export const CORE_EVENTS = [
  ...CORE_ENTITY_EVENTS, "core.tenant.created", "core.member.added", "core.member.removed",
  "core.module.enabled", "core.module.disabled", "core.notification.requested",
];

export const WorkflowInput = z.object({
  name: z.string().trim().min(1).max(200),
  enabled: z.boolean().default(true),
  trigger: z.object({ event: z.string().max(120) }).strict(),
  conditions: z.unknown().nullish(),
  actions: z.array(z.object({ key: z.string().max(120), input: z.record(z.string(), z.unknown()).default({}) }).strict()).min(1).max(50),
}).strict();
export type WorkflowInput = z.infer<typeof WorkflowInput>;

function validateDefinition(registry: ModuleRegistry, w: WorkflowInput, ctx: RequestContext) {
  const known = new Set([...CORE_EVENTS, ...registry.knownEvents()]);
  if (!known.has(w.trigger.event)) throw badRequest(`Unknown trigger event ${w.trigger.event}`);
  for (const a of w.actions) if (!actionExists(registry, a.key)) throw badRequest(`Unknown action ${a.key}`);
  // A workflow runs with the access of the person who saves it, so they need every step's permission.
  if (!ctx.actor.userId) throw forbidden("Workflows must be saved by a person: they run with that person's access");
  for (const a of w.actions) {
    const missing = actionPermissions(registry, a.key, a.input).filter((p) => !hasPermission(ctx.actor.permissions, p));
    if (missing.length) throw forbidden(`You can't use the step ${a.key}: it needs ${missing.join(", ")}, which you don't have`);
  }
  if (w.conditions != null) {
    if (JSON.stringify(w.conditions).length > 16_384) throw badRequest("conditions too large");
    try { jsonLogic.apply(w.conditions as jsonLogic.RulesLogic, { event: {}, payload: {} }); }
    catch (e) { throw badRequest(`Invalid conditions: ${(e as Error).message}`); }
  }
}

const strip = <T extends { tenantId: string; deletedAt?: Date | null }>({ tenantId: _t, deletedAt: _d, ...r }: T) => r;

/** Adds the name of the person each workflow runs as (null when they are no longer a member). */
async function withRunAs<T extends { runAs: string | null }>(tx: Tx, rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.runAs).filter((x): x is string => !!x))];
  const people = ids.length ? await tx.select({ id: users.id, name: users.name, email: users.email }).from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, sql`app_tenant_id()`), eq(memberships.status, "active"), inArray(users.id, ids))) : [];
  return rows.map((r) => {
    const p = people.find((x) => x.id === r.runAs);
    return { ...r, runAsName: p ? p.name || p.email : null };
  });
}

export const workflowService = (registry: ModuleRegistry) => ({
  async list(tx: Tx, ctx: RequestContext) {
    requirePermission(ctx, "core:workflows.read");
    return withRunAs(tx, (await tx.select().from(workflows).where(isNull(workflows.deletedAt)).orderBy(desc(workflows.id))).map(strip));
  },
  async get(tx: Tx, ctx: RequestContext, id: string) {
    requirePermission(ctx, "core:workflows.read");
    const [w] = await tx.select().from(workflows).where(and(eq(workflows.id, id), isNull(workflows.deletedAt)));
    if (!w) throw notFound("Workflow");
    return (await withRunAs(tx, [strip(w)]))[0]!;
  },
  async create(tx: Tx, ctx: RequestContext, input: WorkflowInput) {
    requirePermission(ctx, "core:workflows.manage");
    validateDefinition(registry, input, ctx);
    const id = uuidv7();
    const [w] = await tx.insert(workflows).values({
      id, tenantId: ctx.tenantId, name: input.name, enabled: input.enabled, trigger: input.trigger,
      conditions: input.conditions ?? null, actions: input.actions as WorkflowAction[], createdBy: ctx.actor.userId ?? null, runAs: ctx.actor.userId ?? null,
    }).returning();
    await audit(tx, ctx, "workflow.created", { type: "workflow", id }, input);
    return strip(w!);
  },
  async update(tx: Tx, ctx: RequestContext, id: string, input: WorkflowInput) {
    requirePermission(ctx, "core:workflows.manage");
    validateDefinition(registry, input, ctx);
    const [w] = await tx.update(workflows).set({
      name: input.name, enabled: input.enabled, trigger: input.trigger, conditions: input.conditions ?? null,
      actions: input.actions as WorkflowAction[], version: sql`${workflows.version} + 1`, runAs: ctx.actor.userId ?? null,
    }).where(and(eq(workflows.id, id), isNull(workflows.deletedAt))).returning();
    if (!w) throw notFound("Workflow");
    await audit(tx, ctx, "workflow.updated", { type: "workflow", id }, input);
    return strip(w);
  },
  async remove(tx: Tx, ctx: RequestContext, id: string) {
    requirePermission(ctx, "core:workflows.manage");
    const r = await tx.update(workflows).set({ deletedAt: new Date(), enabled: false })
      .where(and(eq(workflows.id, id), isNull(workflows.deletedAt))).returning({ id: workflows.id });
    if (!r.length) throw notFound("Workflow");
    await audit(tx, ctx, "workflow.deleted", { type: "workflow", id });
  },
  async runs(tx: Tx, ctx: RequestContext, id: string, q: { limit: number; cursor?: string | undefined }) {
    requirePermission(ctx, "core:workflows.read");
    const rows = await tx.select().from(workflowRuns)
      .where(and(eq(workflowRuns.workflowId, id), q.cursor ? lt(workflowRuns.id, q.cursor) : undefined))
      .orderBy(desc(workflowRuns.id)).limit(q.limit);
    return rows.map(({ tenantId: _t, plan: _p, ...r }) => r);
  },
});

// ───────── Matching (called by dispatcher, inside tenant tx) ─────────
export interface RunRef { tenantId: string; runId: string; steps: { key: string; seconds?: number }[] }

/** Create a pending run for every enabled workflow whose trigger + conditions match. Idempotent per event. */
export async function matchWorkflows(tx: Tx, event: EventEnvelope): Promise<RunRef[]> {
  const candidates = await tx.select().from(workflows).where(and(
    eq(workflows.enabled, true), isNull(workflows.deletedAt), sql`trigger_event = ${event.type}`,
  ));
  const refs: RunRef[] = [];
  for (const w of candidates) {
    if (w.conditions != null) {
      let ok = false;
      try { ok = !!jsonLogic.apply(w.conditions as jsonLogic.RulesLogic, { event, payload: event.payload }); } catch { ok = false; }
      if (!ok) continue;
    }
    const runId = uuidv7();
    const ins = await tx.insert(workflowRuns).values({
      id: runId, tenantId: event.tenantId, workflowId: w.id, workflowVersion: w.version, eventId: event.id,
      plan: { event: event as never, actions: w.actions, runAs: w.runAs },
    }).onConflictDoNothing().returning({ id: workflowRuns.id });
    if (!ins.length) continue;
    refs.push({
      tenantId: event.tenantId, runId,
      steps: w.actions.map((a) => ({ key: a.key, ...(a.key === "core.wait" ? { seconds: Number(a.input?.seconds ?? 0) } : {}) })),
    });
  }
  return refs;
}

// ───────── Execution (shared by inline + Temporal runners) ─────────
export interface ExecDeps extends ModuleDeps { db: Db; http: HttpOptions }

/**
 * Execute step `index` of a run in its own tenant transaction. Idempotent: if the step already
 * succeeded (activity retry after commit), returns the stored output.
 */
export async function executeStep(d: ExecDeps, tenantId: string, runId: string, index: number) {
  try {
    return await withTenant(d.db, tenantId, async (tx) => {
      const [run] = await tx.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).for("update");
      if (!run) throw new Error("run not found");
      const done = run.steps[index];
      if (done?.status === "succeeded") return done.output;
      const action = run.plan.actions[index];
      if (!action) throw new Error(`no step ${index}`);
      const ev = run.plan.event;
      const base = systemContext(tenantId, `run:${runId}`, `workflow:${run.workflowId}`, {
        id: ev.id, correlationId: ev.correlationId ?? ev.id, depth: ev.depth ?? 0,
      });
      // Run with the current access of the person who saved the workflow, never with full access.
      let runAs = run.plan.runAs;
      if (runAs === undefined) runAs = (await tx.select({ r: workflows.runAs }).from(workflows).where(eq(workflows.id, run.workflowId)))[0]?.r ?? null;
      const owner = runAs ? await resolveMembership(tx, tenantId, runAs) : null;
      if (!owner) throw new Error("This workflow runs with the access of someone who is no longer a member. Open it and save it again to run it with your access.");
      const ctx: RequestContext = { ...base, actor: { ...base.actor, permissions: owner.permissions } };
      const data = { event: ev, payload: ev.payload, steps: run.steps.map((s) => s.output ?? null) };
      const output = action.key === "core.wait"
        ? { waited: action.input?.seconds ?? 0 }
        : await executeAction({ tx, ctx, deps: d, http: d.http }, action.key, render(action.input ?? {}, data));
      const step: StepResult = { key: action.key, status: "succeeded", output, at: new Date().toISOString() };
      const steps = [...run.steps.slice(0, index), step];
      await tx.update(workflowRuns).set({ steps, status: "running" }).where(eq(workflowRuns.id, runId));
      return output;
    });
  } catch (e) {
    // Record the failure in a separate tx (the step's tx rolled back).
    await withTenant(d.db, tenantId, async (tx) => {
      const [run] = await tx.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
      if (!run) return;
      const failed: StepResult = { key: run.plan.actions[index]?.key ?? "?", status: "failed", error: String((e as Error).message ?? e).slice(0, 1000), at: new Date().toISOString() };
      await tx.update(workflowRuns).set({ steps: [...run.steps.slice(0, index), failed], status: "running" }).where(eq(workflowRuns.id, runId));
    });
    throw e;
  }
}

export async function finishRun(d: Pick<ExecDeps, "db">, tenantId: string, runId: string, status: "succeeded" | "failed", error?: string) {
  await withTenant(d.db, tenantId, (tx) => tx.update(workflowRuns)
    .set({ status, error: error?.slice(0, 2000) ?? null, endedAt: new Date() }).where(eq(workflowRuns.id, runId)));
}

/** Rebuild a RunRef for a run (used by the stale-run recovery sweep). */
export async function runRefFor(db: Db, tenantId: string, runId: string): Promise<RunRef | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [r] = await tx.select().from(workflowRuns).where(and(eq(workflowRuns.id, runId), eq(workflowRuns.status, "pending")));
    if (!r) return null;
    return {
      tenantId, runId,
      steps: r.plan.actions.map((a) => ({ key: a.key, ...(a.key === "core.wait" ? { seconds: Number(a.input?.seconds ?? 0) } : {}) })),
    };
  });
}
