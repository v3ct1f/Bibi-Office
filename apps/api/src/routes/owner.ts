import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import {
  createBusiness, forbidden, INVITATION_DAYS, inviteBusinessOwner, listBusinesses, notFound, platformContext, setBusinessStatus,
  type PlatformAdmin,
} from "@office/core";
import { tenants, withTenant, type Db } from "@office/db";
import { setAllowedModules, type ModuleDeps } from "@office/platform";
import { invitationEmail, type Mailer } from "../mail.ts";

const AUTH = { auth: "authenticated" } as const;
const Id = z.object({ id: z.uuid() });

/**
 * /platform/*: the program owner's area. Lists businesses and creates, pauses and reactivates them.
 * It never opens a business's records; the program owner joins a business only if its owner invites them.
 */
export async function registerOwnerRoutes(
  app0: FastifyInstance,
  o: { db: Db; appUrl: string; mailer: Mailer | null; platformAdmin: (req: FastifyRequest) => PlatformAdmin | null; modules: ModuleDeps },
) {
  const app = app0.withTypeProvider<ZodTypeProvider>();
  const admin = (req: FastifyRequest) => {
    const a = o.platformAdmin(req);
    if (!a) throw forbidden("Only the program owner can do this");
    return a;
  };
  const meta = (req: FastifyRequest) => ({ requestId: req.id, ip: req.ip });

  /** Emails the owner invitation if mail is set up; the link is always returned to copy. */
  async function deliver(req: FastifyRequest, tenant: { id: string; name: string }, inv: { email: string; token: string; expiresAt: Date }) {
    const link = `${o.appUrl}/invite/${tenant.id}/${inv.token}`;
    let emailed = false;
    let emailError: string | null = null;
    if (o.mailer) {
      try {
        await o.mailer.send({ to: inv.email, ...invitationEmail({ tenantName: tenant.name, inviterName: null, link, days: INVITATION_DAYS }) });
        emailed = true;
      } catch (e) {
        req.log.warn({ err: e }, "owner invitation email failed");
        emailError = "The email could not be sent. Copy the link and send it yourself.";
      }
    }
    return { email: inv.email, expiresAt: inv.expiresAt, link, emailed, emailError };
  }

  /** Every feature this installation has, for choosing what each business may use. */
  app.get("/platform/features", { config: AUTH, schema: { tags: ["platform"] } }, async (req) => {
    admin(req);
    return {
      items: o.modules.registry.all().map((m) => ({
        key: m.manifest.key, name: m.manifest.name, description: m.manifest.description, category: m.manifest.category, dependsOn: m.manifest.dependsOn,
      })),
    };
  });

  /** features: null = everything (including features added to the program later); a list = only those (plus what they need). */
  app.put("/platform/businesses/:id/features", {
    config: AUTH,
    schema: { tags: ["platform"], params: Id, body: z.object({ features: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,40}$/)).max(200).nullable() }).strict() },
  }, async (req) => {
    const a = admin(req);
    return withTenant(o.db, req.params.id, async (tx) => {
      const [t] = await tx.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.id, req.params.id), ne(tenants.status, "deleted")));
      if (!t) throw notFound("Business");
      const r = await setAllowedModules(tx, platformContext(t.id, a, meta(req)), o.modules, req.body.features);
      return { features: r.allowed, turnedOff: r.turnedOff };
    });
  });

  app.get("/platform/businesses", { config: AUTH, schema: { tags: ["platform"] } }, async (req) => {
    admin(req);
    return { items: await listBusinesses(o.db) };
  });

  app.post("/platform/businesses", {
    config: AUTH,
    schema: {
      tags: ["platform"],
      body: z.object({
        name: z.string().trim().min(1).max(200),
        slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/),
        region: z.enum(["eu", "us"]).optional(),
        ownerEmail: z.email().max(320),
      }).strict(),
    },
  }, async (req, reply) => {
    const a = admin(req);
    const { tenant, invite } = await createBusiness(o.db, a, req.body, meta(req));
    return reply.status(201).send({
      business: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
      invitation: await deliver(req, tenant, invite),
    });
  });

  app.post("/platform/businesses/:id/owner-invite", {
    config: AUTH, schema: { tags: ["platform"], params: Id, body: z.object({ email: z.email().max(320) }).strict() },
  }, async (req, reply) => {
    const a = admin(req);
    const { tenant, invite } = await inviteBusinessOwner(o.db, a, req.params.id, req.body.email, meta(req));
    return reply.status(201).send({ invitation: await deliver(req, tenant, invite) });
  });

  for (const [path, status] of [["pause", "suspended"], ["resume", "active"]] as const) {
    app.post(`/platform/businesses/:id/${path}`, { config: AUTH, schema: { tags: ["platform"], params: Id } }, async (req) => {
      const a = admin(req);
      return setBusinessStatus(o.db, a, req.params.id, status, meta(req));
    });
  }
}
