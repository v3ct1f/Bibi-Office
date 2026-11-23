import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createDb } from "@office/db";
import { createTestDatabase } from "@office/testing";
import { installModules, ModuleRegistry, SecretBox } from "@office/platform";
import type { ModuleDefinition } from "@office/sdk";
import { buildApp } from "../src/app.ts";

export const ISSUER = "https://idp.test/realms/office";
export const AUDIENCE = "office-api";

export async function setup(modules: ModuleDefinition[] = [], opts: { authFailuresPerMin?: number; mailer?: import("../src/mail.ts").Mailer; identity?: import("../src/identity.ts").Identity; selfSignup?: boolean } = {}) {
  const tdb = await createTestDatabase();
  const registry = new ModuleRegistry(modules);
  if (modules.length) await installModules(tdb.ownerUrl, registry, () => {});
  const secrets = new SecretBox(Buffer.alloc(32, 7).toString("base64"));
  const app_ = createDb(tdb.appUrl);
  const owner = createDb(tdb.ownerUrl, { max: 2 });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const app = await buildApp({
    db: app_.db, logger: false, selfSignup: true, platformAdmins: ["boss@example.com"], ...opts, jwks: createLocalJWKSet({ keys: [jwk] }), platform: { registry, secrets },
    config: {
      OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE, API_KEY_PEPPER: "x".repeat(32),
      CORS_ORIGINS: [], RATE_LIMIT_PER_MIN: 10_000, TRUST_PROXY: false, NODE_ENV: "test",
    },
  });

  const token = (sub: string, email = `${sub}@example.com`, over: Record<string, unknown> = {}) =>
    new SignJWT({ email, name: sub, email_verified: true, ...over })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(ISSUER).setAudience((over.aud as string) ?? AUDIENCE).setSubject(sub).setIssuedAt().setExpirationTime("5m")
      .sign(privateKey);

  /** Tiny client: c(user).get("/contacts", tenantId) */
  const client = (auth: string, tenantId?: string) => {
    const call = async (method: string, url: string, body?: unknown) => {
      const res = await app.inject({
        method: method as "GET", url: `/api/v1${url}`,
        headers: { authorization: `Bearer ${auth}`, ...(tenantId ? { "x-tenant-id": tenantId } : {}) },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
    };
    return {
      get: (u: string) => call("GET", u),
      post: (u: string, b: unknown) => call("POST", u, b),
      patch: (u: string, b: unknown) => call("PATCH", u, b),
      put: (u: string, b: unknown) => call("PUT", u, b),
      del: (u: string) => call("DELETE", u),
    };
  };

  /** Owner role is also subject to RLS (FORCE), so it must pick a tenant too. */
  const asOwner = <T>(tenantId: string, fn: (tx: import("postgres").TransactionSql) => Promise<T>) =>
    owner.sql.begin(async (tx) => { await tx`select set_config('app.tenant_id', ${tenantId}, true)`; return fn(tx); }) as Promise<T>;

  /** Invites the person signed in with userToken and accepts as them; returns their membership id. */
  const join = async (tenantId: string, inviterToken: string, userToken: string, roles: string[]) => {
    const me = (await client(userToken).get("/me")).body as { email: string; userId: string };
    const inv = await client(inviterToken, tenantId).post("/invitations", { email: me.email, roles });
    if (inv.status !== 201) throw new Error(`invite failed: ${JSON.stringify(inv.body)}`);
    const acc = await client(userToken).post("/invitations/accept", { tenantId, token: (inv.body.link as string).split("/").pop() });
    if (acc.status !== 200) throw new Error(`accept failed: ${JSON.stringify(acc.body)}`);
    const members = (await client(inviterToken, tenantId).get("/members")).body as { id: string; userId: string }[];
    return members.find((m) => m.userId === me.userId)!.id;
  };

  return {
    app, token, client, join, asOwner, ownerSql: owner.sql, appSql: app_.sql, db: app_.db, registry, secrets, tdb,
    /** Pending outbox events for a tenant as envelopes (what the relay would publish). */
    async events(tenantId: string, type?: string) {
      const rows = await asOwner(tenantId, (tx) => tx`select * from outbox order by id`);
      return rows.filter((r) => !type || r.type === type).map((r) => ({
        id: r.id, tenantId: r.tenant_id, type: r.type, version: r.version, payload: r.payload,
        actor: { type: r.actor_type, id: r.actor_id }, causationId: r.causation_id,
        correlationId: r.correlation_id ?? r.id, depth: r.depth, occurredAt: new Date(r.occurred_at).toISOString(),
      }));
    },
    async teardown() {
      await app.close(); await app_.close(); await owner.close(); await tdb.drop();
    },
  };
}
