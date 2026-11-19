import { z } from "zod";
import { request } from "undici";
import { emitEvent, entityService, type RequestContext } from "@office/core";
import type { Tx } from "@office/db";
import type { ModuleRegistry } from "../registry.ts";
import { createModuleContext } from "../context.ts";
import { loadEnabledModule, type ModuleDeps } from "../tenant-modules.ts";
import { assertUrlAllowed, guardedAgent } from "../ssrf.ts";

export interface ActionEnv { tx: Tx; ctx: RequestContext; deps: ModuleDeps; http: HttpOptions }
export interface HttpOptions { allowPrivate: boolean; requireHttps: boolean }

interface CoreAction<I extends z.ZodType> { label: string; input: I; run(env: ActionEnv, input: z.infer<I>): Promise<Record<string, unknown> | void> }
const coreAction = <I extends z.ZodType>(a: CoreAction<I>) => a as unknown as CoreAction<z.ZodType>;

const entityEnum = z.enum(["contacts", "companies", "documents", "tasks"]);

export const CORE_ACTIONS: Record<string, CoreAction<z.ZodType>> = {
  "core.create_task": coreAction({
    label: "Create task",
    input: z.object({
      title: z.string().min(1).max(500), description: z.string().max(20_000).nullish(),
      assigneeId: z.uuid().nullish(), dueInDays: z.number().int().min(0).max(3650).nullish(),
      priority: z.number().int().min(0).max(4).nullish(),
    }),
    async run({ tx, ctx }, i) {
      const t = await entityService("tasks").create(tx, ctx, {
        title: i.title, description: i.description ?? null, assigneeId: i.assigneeId ?? null, priority: i.priority ?? 2,
        dueAt: i.dueInDays != null ? new Date(Date.now() + i.dueInDays * 86_400_000) : null,
      });
      return { taskId: t.id };
    },
  }),
  "core.update_record": coreAction({
    label: "Update record",
    input: z.object({ entity: entityEnum, id: z.uuid(), changes: z.record(z.string(), z.unknown()) }),
    async run({ tx, ctx }, i) {
      await entityService(i.entity).update(tx, ctx, i.id, i.changes);
      return { id: i.id };
    },
  }),
  "core.notify": coreAction({
    label: "Notify user",
    input: z.object({ userId: z.uuid().nullish(), message: z.string().min(1).max(2000) }),
    async run({ tx, ctx }, i) {
      const id = await emitEvent(tx, ctx, "core.notification.requested", { userId: i.userId ?? null, message: i.message });
      return { eventId: id };
    },
  }),
  "core.http_request": coreAction({
    label: "HTTP request",
    input: z.object({
      url: z.string().url().max(2048), method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("POST"),
      headers: z.record(z.string().regex(/^[\w-]+$/), z.string().max(4096)).default({}), body: z.unknown().optional(),
    }),
    async run({ http }, i) {
      assertUrlAllowed(i.url, http);
      const res = await request(i.url, {
        method: i.method, dispatcher: guardedAgent({ allowPrivate: http.allowPrivate }),
        headers: { "content-type": "application/json", "user-agent": "Office-Workflows/1", ...i.headers },
        body: i.body === undefined ? null : JSON.stringify(i.body),
      });
      const text = (await res.body.text()).slice(0, 4096);
      if (res.statusCode >= 400) throw new Error(`HTTP ${res.statusCode}`);
      return { status: res.statusCode, body: text };
    },
  }),
  "core.wait": coreAction({
    label: "Wait",
    input: z.object({ seconds: z.number().int().min(1).max(90 * 86_400) }),
    async run() { throw new Error("core.wait is executed by the workflow engine, not as an activity"); },
  }),
};

/** Catalog for the workflow builder: core + enabled-or-not module actions, with JSON Schemas. */
export function actionCatalog(registry: ModuleRegistry) {
  const core = Object.entries(CORE_ACTIONS).map(([key, a]) => ({ key, module: "core", label: a.label, input: z.toJSONSchema(a.input) }));
  const mods = registry.all().flatMap((m) => Object.entries(m.actions ?? {}).map(([key, a]) => ({
    key, module: m.manifest.key, label: a.label, input: z.toJSONSchema(a.input),
  })));
  return [...core, ...mods];
}

export function actionExists(registry: ModuleRegistry, key: string) {
  return key in CORE_ACTIONS || !!registry.action(key);
}

/** Run one (already rendered) action. Module actions require the module enabled for the tenant. */
export async function executeAction(env: ActionEnv, key: string, rawInput: unknown): Promise<Record<string, unknown>> {
  const core = CORE_ACTIONS[key];
  if (core) {
    const input = core.input.parse(rawInput);
    return (await core.run(env, input)) ?? {};
  }
  const found = env.deps.registry.action(key);
  if (!found) throw new Error(`Unknown action ${key}`);
  const loaded = await loadEnabledModule(env.tx, env.deps, env.ctx.tenantId, found.module.manifest.key);
  if (!loaded) throw new Error(`Module ${found.module.manifest.key} is not enabled`);
  const input = found.spec.input.parse(rawInput);
  return (await found.spec.run(createModuleContext(env.tx, env.ctx, loaded.def, loaded.state), input)) ?? {};
}
