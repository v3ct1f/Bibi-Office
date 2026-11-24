import { eq } from "drizzle-orm";
import { AppError, audit, type Plan, peopleCount, planByKey, tenantPlan, type PlanInterval, type RequestContext } from "@office/core";
import { tenants, type Tx } from "@office/db";
import type { ModuleRegistry } from "./registry.ts";
import { setAllowedModules, withDependencies, type ModuleDeps } from "./tenant-modules.ts";

/** The features of a plan that this installation actually has (plus what they depend on). */
export const planModuleKeys = (registry: ModuleRegistry, plan: Plan) => withDependencies(registry, plan.features.filter((k) => registry.get(k)));

/**
 * Moves a business to another plan (test payment: nothing is charged). The features follow the plan straight away:
 * features the new plan doesn't include are turned off, their data kept. Going down is refused while the team is
 * bigger than the new plan includes.
 */
export async function changePlan(tx: Tx, ctx: RequestContext, d: ModuleDeps, input: { plan: string; interval: PlanInterval }) {
  const target = planByKey(input.plan);
  if (!target) throw new AppError(400, "bad_plan", "Unknown plan");
  const cur = await tenantPlan(tx, ctx.tenantId);
  if (cur.stripe) throw new AppError(409, "paid_by_stripe", "This business pays through Stripe. Change the plan from Manage subscription.");
  if (cur.key === target.key && cur.interval === input.interval) throw new AppError(409, "same_plan", `You're already on ${target.name} (${input.interval}).`);
  const people = await peopleCount(tx, ctx.tenantId);
  if (people > target.people) {
    throw new AppError(409, "too_many_people",
      `${target.name} includes ${target.people} people and you have ${people} (members and waiting invitations). Remove ${people - target.people} first, then switch.`);
  }
  await tx.update(tenants).set({ plan: target.key, planInterval: input.interval, planTest: true, planChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(tenants.id, ctx.tenantId));
  const r = await setAllowedModules(tx, ctx, d, planModuleKeys(d.registry, target));
  await audit(tx, ctx, "tenant.plan_changed", { type: "tenant", id: ctx.tenantId },
    { from: cur.key, to: target.key, interval: input.interval, testPayment: true, turnedOff: r.turnedOff });
  return { plan: target.key, interval: input.interval, turnedOff: r.turnedOff };
}
