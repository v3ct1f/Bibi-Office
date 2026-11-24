import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  ENTITIES, entityService, createTenant, listUserTenants, getTenant, listMembers, setMemberRoles, notFound,
  createInvitation, listInvitations, revokeInvitation, viewInvitation, acceptInvitation, INVITATION_DAYS,
  removeMember, listRoles, upsertRole, deleteRole, createApiKey, listApiKeys, revokeApiKey, verifyAuditChain,
  forbidden, isPlatformAdmin, assertCapability, CORE_PERMISSIONS, checkGrantableRoles, addCreatedColleague, upsertUser, AppError,
  type EntityKey, type RequestContext,
} from "@office/core";
import { auditLog, tenants, users, withTenant, type Db, type Tx } from "@office/db";
import { invitationEmail, passwordResetEmail, type Mailer } from "../mail.ts";
import type { Identity } from "../identity.ts";
import { registerOwnerRoutes } from "./owner.ts";
import { registerBillingRoutes } from "./billing.ts";
import { registerContactRoutes } from "./contact.ts";
import type { Billing } from "../billing.ts";

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

export const registerRoutes: FastifyPluginAsync<{
  db: Db; inTenant: InTenant; pepper: string; appUrl: string; mailer: Mailer | null; identity: Identity | null; selfSignup: boolean; testPayments: boolean; billing: Billing | null; contactEmail: string | undefined;
  modules: import("@office/platform").ModuleDeps;
}> = async (app0, o) => {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const { db, inTenant } = o;
  /** A program owner: signed in with a verified email that is on the program-owner list. */
  const platformAdmin = async (req: import("fastify").FastifyRequest) => {
    const p = req.principal;
    if (p?.kind !== "user" || !p.emailVerified) return null;
    return (await isPlatformAdmin(db, p.email)) ? { userId: p.userId, email: p.email.toLowerCase() } : null;
  };

  // ───── Me / tenants ─────
  app.get("/me", { config: AUTH, schema: { tags: ["me"] } }, async (req) => {
    const p = req.principal!;
    if (p.kind !== "user") return { kind: p.kind, tenantId: p.tenantId, scopes: [...p.scopes] };
    return {
      kind: "user", userId: p.userId, email: p.email, tenants: await listUserTenants(db, p.userId),
      platformAdmin: !!(await platformAdmin(req)), selfSignup: o.selfSignup,
    };
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
    if (!o.selfSignup && !(await platformAdmin(req))) throw forbidden("New businesses are set up by the program owner. Ask them for an invitation.");
    const t = await createTenant(db, req.body, { userId: p.userId }, { requestId: req.id, ip: req.ip, userAgent: req.headers["user-agent"] });
    return reply.status(201).send(t);
  });

  app.get("/tenant", { config: AUTH, schema: { tags: ["tenants"], headers: tenantHeader } },
    (req) => inTenant(req, null, async (_tx, ctx) => getTenant(db, ctx.tenantId)));

  // ───── Program owner (all businesses; never their data) ─────
  /**
   * Forgot password / never set one: emails a one-time link from the sign-in service. Always answers the same,
   * so nobody can find out which emails have accounts.
   */
  app.post("/auth/forgot-password", {
    config: { auth: "public", rateLimit: { max: 5, timeWindow: "15 minutes" } },
    schema: { tags: ["auth"], body: z.object({ email: z.email().max(320) }).strict() },
  }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    if (o.mailer && o.identity) {
      try {
        const pw = await o.identity.passwordLink(email);
        if (pw?.link) await o.mailer.send({ to: email, ...passwordResetEmail({ link: pw.link, hasPassword: pw.hasPassword }) });
      } catch (e) { req.log.warn({ err: e }, "password email failed"); }
    }
    return reply.status(202).send({ ok: true, available: !!(o.mailer && o.identity) });
  });

  await registerContactRoutes(app, { db, mailer: o.mailer, contactEmail: o.contactEmail, inTenant });
  await registerBillingRoutes(app, { db, appUrl: o.appUrl, mailer: o.mailer, identity: o.identity, billing: o.billing, contactEmail: o.contactEmail, inTenant, testPayments: o.testPayments, modules: o.modules });
  await registerOwnerRoutes(app, { db, appUrl: o.appUrl, mailer: o.mailer, identity: o.identity, platformAdmin, modules: o.modules });

  // ───── Members ─────
  app.get("/members", { config: AUTH, schema: { tags: ["members"], headers: tenantHeader } },
    (req) => inTenant(req, "core:members.read", (tx, ctx) => listMembers(tx, ctx)));

  // ───── Invitations: people join only by accepting a link sent to their own email address ─────
  app.get("/invitations", { config: AUTH, schema: { tags: ["members"], headers: tenantHeader } },
    (req) => inTenant(req, "core:members.manage", (tx) => listInvitations(tx)));

  app.post("/invitations", {
    config: AUTH,
    schema: { tags: ["members"], headers: tenantHeader, body: z.object({ email: z.email().max(320), roles: z.array(z.string().max(41)).min(1).max(20) }).strict() },
  }, async (req, reply) => {
    if (req.principal?.kind !== "user") throw forbidden("Only people can invite people");
    const { inv, tenantName, inviter } = await inTenant(req, "core:members.manage", async (tx, ctx) => {
      const t = (await getTenant(db, ctx.tenantId))!;
      const me = req.principal as { email: string };
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, ctx.actor.userId!));
      return { inv: await createInvitation(tx, ctx, req.body), tenantName: t.name, inviter: u?.name || me.email };
    });
    const link = `${o.appUrl}/invite/${req.headers["x-tenant-id"]}/${inv.token}`;
    let emailed = false, emailError: string | null = null;
    if (o.mailer) {
      try {
        const pw = await o.identity?.passwordLink(inv.email, link);
        const passwordLink = pw && !pw.hasPassword ? pw.link : null;
        await o.mailer.send({ to: inv.email, ...invitationEmail({ tenantName, inviterName: inviter, link, days: INVITATION_DAYS, passwordLink }) });
        emailed = true;
      } catch (e) {
        req.log.warn({ err: e }, "invitation email failed");
        emailError = "The email could not be sent. Copy the link and send it yourself.";
      }
    }
    const { token: _t, ...rest } = inv;
    return reply.status(201).send({ ...rest, link, emailed, emailError });
  });

  app.delete("/invitations/:id", { config: AUTH, schema: { tags: ["members"], headers: tenantHeader, params: Id } }, async (req, reply) => {
    await inTenant(req, "core:members.manage", (tx, ctx) => revokeInvitation(tx, ctx, req.params.id));
    return reply.status(204).send();
  });

  // The invited person, signed in but not (yet) a member: look at and accept an invitation.
  // The token travels in the body, not the URL, so it doesn't end up in request logs.
  const InviteRef = z.object({ tenantId: z.uuid(), token: z.string().max(64) }).strict();
  const inInviteTenant = async <T>(req: import("fastify").FastifyRequest, tenantId: string, fn: (tx: Tx, user: { userId: string; email: string }) => Promise<T>) => {
    const p = req.principal!;
    if (p.kind !== "user") throw forbidden("Sign in as a person to accept an invitation");
    const tid = tenantId.toLowerCase();
    return withTenant(db, tid, async (tx) => {
      const [t] = await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, tid), eq(tenants.status, "active")));
      if (!t) throw notFound("Invitation");
      return fn(tx, { userId: p.userId, email: p.email });
    });
  };
  app.post("/invitations/view", { config: AUTH, schema: { tags: ["members"], body: InviteRef } },
    (req) => inInviteTenant(req, req.body.tenantId, (tx, user) => viewInvitation(tx, req.body.tenantId.toLowerCase(), req.body.token, user)));
  app.post("/invitations/accept", { config: AUTH, schema: { tags: ["members"], body: InviteRef } },
    (req) => inInviteTenant(req, req.body.tenantId, (tx, user) => acceptInvitation(tx, req.body.tenantId.toLowerCase(), req.body.token, user,
      { requestId: req.id, ip: req.ip, userAgent: req.headers["user-agent"] })));

  // ───── Colleagues: the owner creates a sign-in account with a starting password ─────
  // The person signs in with it once and is then asked to choose their own. The password goes straight to the
  // sign-in service; Office doesn't keep it, log it or send it anywhere else.
  app.post("/members/accounts", {
    config: AUTH,
    schema: {
      tags: ["members"], headers: tenantHeader,
      body: z.object({
        name: z.string().trim().min(1).max(200), email: z.email().max(320),
        password: z.string().min(10, "Use at least 10 characters").max(200), roles: z.array(z.string().max(41)).min(1).max(20),
      }).strict(),
    },
  }, async (req, reply) => {
    if (req.principal?.kind !== "user") throw forbidden("Only people can add people");
    const email = req.body.email.trim().toLowerCase();
    // Check first (permission, roles, not already here), so no account is made for a request that would fail.
    await inTenant(req, "core:members.manage", (tx, ctx) => checkGrantableRoles(tx, ctx, { email, roles: req.body.roles }));
    if (!o.identity) throw new AppError(503, "accounts_unavailable", "Creating accounts isn't set up on this server. Send an invitation instead.");
    const made = await o.identity.createAccount({ email, name: req.body.name, password: req.body.password });
    if (made === "exists") {
      throw new AppError(409, "account_exists", `${email} already has an Office account. Send them an invitation instead; they join when they accept it.`);
    }
    const u = await upsertUser(db, { sub: made.sub, email, name: req.body.name });
    const m = await inTenant(req, "core:members.manage", (tx, ctx) => addCreatedColleague(tx, ctx, { userId: u.id, email, roles: req.body.roles }));
    return reply.status(201).send({ id: m.id, userId: u.id, email, name: req.body.name, roles: [...new Set(req.body.roles)] });
  });

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
    const k = await inTenant(req, "core:apikeys.manage", async (tx, ctx) => { await assertCapability(tx, ctx.tenantId, "api"); return createApiKey(tx, ctx, o.pepper, req.body); });
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
