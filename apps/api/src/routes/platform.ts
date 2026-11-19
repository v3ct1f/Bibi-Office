import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AppError, getTenant, hasPermission, requirePermission, type RequestContext } from "@office/core";
import type { Db, Tx } from "@office/db";
import {
  actionCatalog, createModuleContext, disableModule, enableModule, enabledModuleKeys, listModules, loadEnabledModule,
  updateModuleSettings, webhookService, WebhookInput, workflowService, WorkflowInput, CORE_EVENTS,
  type ModuleRegistry, type SecretBox,
} from "@office/platform";

type InTenant = <T>(req: FastifyRequest, perm: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T>;
export interface PlatformOpts { db: Db; inTenant: InTenant; registry: ModuleRegistry; secrets: SecretBox; requireHttps: boolean }

const AUTH = { auth: "authenticated" } as const;
const Id = z.object({ id: z.uuid() });
const ModKey = z.object({ key: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/) });
const tenantHeader = z.object({ "x-tenant-id": z.uuid().optional() }).loose();

export const registerPlatformRoutes: FastifyPluginAsync<PlatformOpts> = async (app0, o) => {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const { inTenant, registry } = o;
  const md = { registry, secrets: o.secrets };
  const wf = workflowService(registry);
  const wh = webhookService({ secrets: o.secrets, requireHttps: o.requireHttps });

  // ───── Access summary for UIs: who am I in this tenant, which module UI slots can I see ─────
  app.get("/me/access", { config: AUTH, schema: { tags: ["me"], headers: tenantHeader } },
    (req) => inTenant(req, null, async (tx, ctx) => {
      const t = (await getTenant(o.db, ctx.tenantId))!;
      const can = (p?: string) => !p || hasPermission(ctx.actor.permissions, p);
      const enabled = await enabledModuleKeys(tx);
      return {
        tenant: { id: t.id, slug: t.slug, name: t.name, region: t.region, plan: t.plan, createdAt: t.createdAt },
        actor: { type: ctx.actor.type, id: ctx.actor.id },
        permissions: [...ctx.actor.permissions].sort(),
        modules: registry.all().filter((m) => enabled.has(m.manifest.key)).map((m) => ({
          key: m.manifest.key, name: m.manifest.name, version: m.manifest.version,
          slots: m.manifest.ui.slots.filter((s) => can(s.permission)),
        })),
      };
    }));

  // ───── Modules (admin) ─────
  app.get("/modules", { config: AUTH, schema: { tags: ["modules"], headers: tenantHeader } },
    (req) => inTenant(req, "core:modules.read", (tx) => listModules(tx, md)));
  app.post("/modules/:key/enable", { config: AUTH, schema: { tags: ["modules"], headers: tenantHeader, params: ModKey } },
    (req) => inTenant(req, "core:modules.manage", (tx, ctx) => enableModule(tx, ctx, md, req.params.key)));
  app.post("/modules/:key/disable", { config: AUTH, schema: { tags: ["modules"], headers: tenantHeader, params: ModKey } },
    (req) => inTenant(req, "core:modules.manage", (tx, ctx) => disableModule(tx, ctx, md, req.params.key)));
  app.patch("/modules/:key/settings", {
    config: AUTH, schema: { tags: ["modules"], headers: tenantHeader, params: ModKey, body: z.record(z.string(), z.unknown()) },
  }, (req) => inTenant(req, "core:modules.manage", (tx, ctx) => updateModuleSettings(tx, ctx, md, req.params.key, req.body)));

  // ───── Workflows ─────
  app.get("/workflow-catalog", { config: AUTH, schema: { tags: ["workflows"], headers: tenantHeader } },
    (req) => inTenant(req, "core:workflows.read", async () => ({
      events: [...CORE_EVENTS, ...registry.knownEvents()], actions: actionCatalog(registry),
    })));
  app.get("/workflows", { config: AUTH, schema: { tags: ["workflows"], headers: tenantHeader } },
    (req) => inTenant(req, null, (tx, ctx) => wf.list(tx, ctx)));
  app.get("/workflows/:id", { config: AUTH, schema: { tags: ["workflows"], headers: tenantHeader, params: Id } },
    (req) => inTenant(req, null, (tx, ctx) => wf.get(tx, ctx, req.params.id)));
  app.post("/workflows", { config: AUTH, schema: { tags: ["workflows"], headers: tenantHeader, body: WorkflowInput } },
    async (req, reply) => reply.status(201).send(await inTenant(req, null, (tx, ctx) => wf.create(tx, ctx, req.body))));
  app.put("/workflows/:id", { config: AUTH, schema: { tags: ["workflows"], headers: tenantHeader, params: Id, body: WorkflowInput } },
    (req) => inTenant(req, null, (tx, ctx) => wf.update(tx, ctx, req.params.id, req.body)));
  app.delete("/workflows/:id", { config: AUTH, schema: { tags: ["workflows"], headers: tenantHeader, params: Id } }, async (req, reply) => {
    await inTenant(req, null, (tx, ctx) => wf.remove(tx, ctx, req.params.id));
    return reply.status(204).send();
  });
  app.get("/workflows/:id/runs", {
    config: AUTH,
    schema: { tags: ["workflows"], headers: tenantHeader, params: Id, querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.uuid().optional() }) },
  }, (req) => inTenant(req, null, (tx, ctx) => wf.runs(tx, ctx, req.params.id, req.query)));

  // ───── Webhooks ─────
  app.get("/webhooks", { config: AUTH, schema: { tags: ["webhooks"], headers: tenantHeader } },
    (req) => inTenant(req, null, (tx, ctx) => wh.list(tx, ctx)));
  app.post("/webhooks", { config: AUTH, schema: { tags: ["webhooks"], headers: tenantHeader, body: WebhookInput } },
    async (req, reply) => reply.status(201).send({
      ...(await inTenant(req, null, (tx, ctx) => wh.create(tx, ctx, req.body))),
      note: "Store the signing secret now; it is not shown again.",
    }));
  app.put("/webhooks/:id", { config: AUTH, schema: { tags: ["webhooks"], headers: tenantHeader, params: Id, body: WebhookInput } },
    (req) => inTenant(req, null, (tx, ctx) => wh.update(tx, ctx, req.params.id, req.body)));
  app.delete("/webhooks/:id", { config: AUTH, schema: { tags: ["webhooks"], headers: tenantHeader, params: Id } }, async (req, reply) => {
    await inTenant(req, null, (tx, ctx) => wh.remove(tx, ctx, req.params.id));
    return reply.status(204).send();
  });
  app.get("/webhooks/:id/deliveries", {
    config: AUTH, schema: { tags: ["webhooks"], headers: tenantHeader, params: Id, querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }) },
  }, (req) => inTenant(req, null, (tx, ctx) => wh.deliveries(tx, ctx, req.params.id, req.query.limit)));
  app.post("/webhooks/:id/deliveries/:deliveryId/redeliver", {
    config: AUTH, schema: { tags: ["webhooks"], headers: tenantHeader, params: z.object({ id: z.uuid(), deliveryId: z.uuid() }) },
  }, async (req, reply) => {
    await inTenant(req, null, (tx, ctx) => wh.redeliver(tx, ctx, req.params.id, req.params.deliveryId));
    return reply.status(202).send();
  });

  // ───── Module routes: /m/<key>/<path>, only when enabled for the tenant ─────
  for (const m of registry.all()) {
    const key = m.manifest.key;
    for (const r of m.routes ?? []) {
      app.route({
        method: r.method,
        url: `/m/${key}${r.path === "/" ? "" : r.path}`,
        config: AUTH,
        ...(r.bodyLimit ? { bodyLimit: Math.min(r.bodyLimit, 10 * 1024 * 1024) } : {}),
        schema: {
          tags: [`module:${key}`], headers: tenantHeader,
          ...(r.body ? { body: r.body } : {}), ...(r.query ? { querystring: r.query } : {}), ...(r.params ? { params: r.params } : {}),
        },
        handler: async (req, reply) => {
          const out = await inTenant(req, null, async (tx, ctx) => {
            const loaded = await loadEnabledModule(tx, md, ctx.tenantId, key);
            if (!loaded) throw new AppError(403, "module_disabled", `${m.manifest.name} is turned off for this company. An owner or admin can add it under Add features.`);
            requirePermission(ctx, r.permission);
            return r.handler(createModuleContext(tx, ctx, loaded.def, loaded.state, req.log), {
              body: req.body, query: req.query, params: req.params,
            });
          });
          return reply.status(r.status ?? (out === undefined ? 204 : 200)).send(out);
        },
      });
    }
  }
};
