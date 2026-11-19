import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  ENTITIES, entityService, createTenant, listUserTenants, getTenant, listMembers, addMember, setMemberRoles,
  removeMember, listRoles, upsertRole, deleteRole, createApiKey, listApiKeys, revokeApiKey, verifyAuditChain,
  forbidden, CORE_PERMISSIONS, type EntityKey, type RequestContext,
} from "@office/core";
import { auditLog, type Db, type Tx } from "@office/db";

type InTenant = <T>(req: import("fastify").FastifyRequest, perm: string | null,
  fn: (tx: Tx, ctx: RequestContext) => Promise<T>) => Promise<T>;

const AUTH = { auth: "authenticated" } as const;
const Id = z.object({ id: z.uuid() });
const Page = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  q: z.string().max(200).optional(),
});
const tenantHeader = z.object({ "x-tenant-id": z.uuid().optional() }).loose();

export const registerRoutes: FastifyPluginAsync<{ db: Db; inTenant: InTenant; pepper: string }> = async (app0, o) => {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const { db, inTenant } = o;

  // ───── Me / tenants ─────
  app.get("/me", { config: AUTH, schema: { tags: ["me"] } }, async (req) => {
    const p = req.principal!;
    if (p.kind !== "user") return { kind: p.kind, tenantId: p.tenantId, scopes: [...p.scopes] };
    return { kind: "user", userId: p.userId, email: p.email, tenants: await listUserTenants(db, p.userId) };
  });

  app.post("/tenants", {
    config: AUTH,
    schema: {
      tags: ["tenants"],
      body: z.object({
        slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/),
        name: z.string().trim().min(1).max(200),
        region: z.enum(["eu", "us"]).optional(),
      }).strict(),
    },
  }, async (req, reply) => {
    const p = req.principal!;
    if (p.kind !== "user") throw forbidden("Only users can create tenants");
    const t = await createTenant(db, req.body, { userId: p.userId }, { requestId: req.id, ip: req.ip, userAgent: req.headers["user-agent"] });
    return reply.status(201).send(t);
  });

  /** Effective permissions of the caller in the selected tenant (UI uses it to hide what you can't do). */
  app.get("/me/permissions", { config: AUTH, schema: { tags: ["me"], headers: tenantHeader } },
    (req) => inTenant(req, null, async (_tx, ctx) => ({ tenantId: ctx.tenantId, permissions: [...ctx.actor.permissions].sort() })));

  app.get("/tenant", { config: AUTH, schema: { tags: ["tenants"], headers: tenantHeader } },
    (req) => inTenant(req, null, async (_tx, ctx) => getTenant(db, ctx.tenantId)));

  // ───── Members ─────
  app.get("/members", { config: AUTH, schema: { tags: ["members"], headers: tenantHeader } },
    (req) => inTenant(req, "core:members.read", (tx, ctx) => listMembers(tx, ctx)));

  app.post("/members", {
    config: AUTH,
    schema: { tags: ["members"], headers: tenantHeader, body: z.object({ email: z.email(), roles: z.array(z.string()).min(1).max(20) }).strict() },
  }, async (req, reply) => reply.status(201).send(await inTenant(req, "core:members.manage", (tx, ctx) => addMember(tx, ctx, req.body))));

  app.put("/members/:id/roles", {
    config: AUTH,
    schema: { tags: ["members"], headers: tenantHeader, params: Id, body: z.object({ roles: z.array(z.string()).max(20) }).strict() },
  }, async (req, reply) => {
    await inTenant(req, "core:members.manage", (tx, ctx) => setMemberRoles(tx, ctx, req.params.id, req.body.roles));
    return reply.status(204).send();
  });

  app.delete("/members/:id", { config: AUTH, schema: { tags: ["members"], headers: tenantHeader, params: Id } }, async (req, reply) => {
    await inTenant(req, "core:members.manage", (tx, ctx) => removeMember(tx, ctx, req.params.id));
    return reply.status(204).send();
  });

  // ───── Roles ─────
  app.get("/permissions", { config: AUTH, schema: { tags: ["roles"] } }, async () => ({ core: CORE_PERMISSIONS }));

  app.get("/roles", { config: AUTH, schema: { tags: ["roles"], headers: tenantHeader } },
    (req) => inTenant(req, "core:roles.read", (tx) => listRoles(tx)));

  app.put("/roles/:key", {
    config: AUTH,
    schema: {
      tags: ["roles"], headers: tenantHeader,
      params: z.object({ key: z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/) }),
      body: z.object({ name: z.string().trim().min(1).max(100), permissions: z.array(z.string().max(120)).max(500) }).strict(),
    },
  }, (req) => inTenant(req, "core:roles.manage", (tx, ctx) => upsertRole(tx, ctx, { key: req.params.key, ...req.body })));

  app.delete("/roles/:key", {
    config: AUTH, schema: { tags: ["roles"], headers: tenantHeader, params: z.object({ key: z.string().max(41) }) },
  }, async (req, reply) => {
    await inTenant(req, "core:roles.manage", (tx, ctx) => deleteRole(tx, ctx, req.params.key));
    return reply.status(204).send();
  });

  // ───── API keys ─────
  app.get("/api-keys", { config: AUTH, schema: { tags: ["api-keys"], headers: tenantHeader } },
    (req) => inTenant(req, "core:apikeys.manage", (tx, ctx) => listApiKeys(tx, ctx)));

  app.post("/api-keys", {
    config: AUTH,
    schema: {
      tags: ["api-keys"], headers: tenantHeader,
      body: z.object({
        name: z.string().trim().min(1).max(100),
        scopes: z.array(z.string().max(120)).min(1).max(100),
        expiresAt: z.coerce.date().optional(),
      }).strict(),
    },
  }, async (req, reply) => {
    if (req.principal?.kind !== "user") throw forbidden("API keys cannot mint API keys");
    const k = await inTenant(req, "core:apikeys.manage", (tx, ctx) => createApiKey(tx, ctx, o.pepper, req.body));
    return reply.status(201).send({ ...k, note: "Store this token now; it is not shown again." });
  });

  app.delete("/api-keys/:id", { config: AUTH, schema: { tags: ["api-keys"], headers: tenantHeader, params: Id } }, async (req, reply) => {
    await inTenant(req, "core:apikeys.manage", (tx, ctx) => revokeApiKey(tx, ctx, req.params.id));
    return reply.status(204).send();
  });

  // ───── Audit ─────
  app.get("/audit", {
    config: AUTH,
    schema: {
      tags: ["audit"], headers: tenantHeader,
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.coerce.number().int().positive().optional(),
        entityType: z.string().max(64).optional(),
        entityId: z.uuid().optional(),
      }),
    },
  }, (req) => inTenant(req, "core:audit.read", async (tx) => {
    const q = req.query;
    const where = [
      q.before ? lt(auditLog.seq, q.before) : undefined,
      q.entityType ? eq(auditLog.entityType, q.entityType) : undefined,
      q.entityId ? eq(auditLog.entityId, q.entityId) : undefined,
    ].filter(Boolean);
    const rows = await tx.select().from(auditLog).where(and(...where)).orderBy(desc(auditLog.seq)).limit(q.limit);
    return {
      data: rows.map(({ tenantId: _t, prevHash: _p, hash, ...r }) => ({ ...r, hash: hash.toString("hex") })),
      nextBefore: rows.length === q.limit ? rows.at(-1)!.seq : null,
    };
  }));

  app.get("/audit/verify", { config: AUTH, schema: { tags: ["audit"], headers: tenantHeader } },
    (req) => inTenant(req, "core:audit.read", async (tx) => {
      const bad = await verifyAuditChain(tx);
      return { intact: bad === null, firstBrokenSeq: bad };
    }));

  // ───── Shared data: contacts, companies, documents, tasks ─────
  for (const key of Object.keys(ENTITIES) as EntityKey[]) {
    const svc = entityService(key);
    const tags = [key];
    const base = `/${key}`;

    app.get(base, { config: AUTH, schema: { tags, headers: tenantHeader, querystring: Page } },
      (req) => inTenant(req, null, (tx, ctx) => svc.list(tx, ctx, req.query)));

    app.get(`${base}/:id`, { config: AUTH, schema: { tags, headers: tenantHeader, params: Id } },
      (req) => inTenant(req, null, (tx, ctx) => svc.get(tx, ctx, req.params.id)));

    app.post(base, { config: AUTH, schema: { tags, headers: tenantHeader, body: svc.def.create } },
      async (req, reply) => reply.status(201).send(await inTenant(req, null, (tx, ctx) => svc.create(tx, ctx, req.body))));

    app.patch(`${base}/:id`, { config: AUTH, schema: { tags, headers: tenantHeader, params: Id, body: svc.def.update } },
      (req) => inTenant(req, null, (tx, ctx) => svc.update(tx, ctx, req.params.id, req.body)));

    app.delete(`${base}/:id`, { config: AUTH, schema: { tags, headers: tenantHeader, params: Id } }, async (req, reply) => {
      await inTenant(req, null, (tx, ctx) => svc.remove(tx, ctx, req.params.id));
      return reply.status(204).send();
    });
  }
};
