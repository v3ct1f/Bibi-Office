import type { FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  forbidden, badRequest, hasPermission, notFound, requirePermission, resolveMembership, unauthorized, type RequestContext,
} from "@office/core";
import { tenants, withTenant, type Db, type Tx } from "@office/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve tenant + actor for the request and run fn inside an RLS-bound transaction.
 * Users pick a tenant with X-Tenant-Id; API keys are bound to exactly one tenant.
 */
export function makeTenantRunner(db: Db) {
  return async function inTenant<T>(
    req: FastifyRequest, permission: string | null, fn: (tx: Tx, ctx: RequestContext) => Promise<T>,
  ): Promise<T> {
    const p = req.principal;
    if (!p) throw forbidden();
    const header = req.headers["x-tenant-id"];
    const requested = Array.isArray(header) ? header[0] : header;
    let tenantId: string;
    if (p.kind === "api_key") {
      if (requested && requested !== p.tenantId) throw forbidden("API key not valid for this tenant");
      tenantId = p.tenantId;
    } else {
      if (!requested || !UUID_RE.test(requested)) throw badRequest("X-Tenant-Id header required");
      tenantId = requested.toLowerCase();
    }

    return withTenant(db, tenantId, async (tx) => {
      const [t] = await tx.select({ id: tenants.id }).from(tenants)
        .where(and(eq(tenants.id, tenantId), eq(tenants.status, "active")));
      if (!t) throw notFound("Tenant");
      let ctx: RequestContext;
      const meta = { tenantId, requestId: req.id, ip: req.ip, userAgent: req.headers["user-agent"] };
      if (p.kind === "api_key") {
        // A key never holds more than its creator has *now*: scopes the creator lost are dropped, and the
        // key stops working once its creator leaves the company.
        const owner = p.createdBy ? await resolveMembership(tx, tenantId, p.createdBy) : null;
        if (!owner) throw unauthorized("API key is no longer valid: the person who created it is not a member any more");
        const permissions = new Set([...p.scopes].filter((s) => hasPermission(owner.permissions, s)));
        ctx = { ...meta, actor: { type: "api_key", id: p.keyId, permissions } };
      } else {
        const m = await resolveMembership(tx, tenantId, p.userId);
        if (!m) throw notFound("Tenant"); // don't reveal existence to non-members
        ctx = { ...meta, actor: { type: "user", id: p.userId, userId: p.userId, membershipId: m.membershipId, permissions: m.permissions } };
      }
      if (permission) requirePermission(ctx, permission);
      return fn(tx, ctx);
    });
  };
}
