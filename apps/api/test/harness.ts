import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { createDb } from "@office/db";
import { createTestDatabase } from "@office/testing";
import { buildApp } from "../src/app.ts";

export const ISSUER = "https://idp.test/realms/office";
export const AUDIENCE = "office-api";

export async function setup() {
  const tdb = await createTestDatabase();
  const app_ = createDb(tdb.appUrl);
  const owner = createDb(tdb.ownerUrl, { max: 2 });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const app = await buildApp({
    db: app_.db, logger: false, jwks: createLocalJWKSet({ keys: [jwk] }),
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

  return {
    app, token, client, asOwner, ownerSql: owner.sql, appSql: app_.sql,
    async teardown() {
      await app.close(); await app_.close(); await owner.close(); await tdb.drop();
    },
  };
}
