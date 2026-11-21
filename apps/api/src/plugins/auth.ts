import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { unauthorized, upsertUser, verifyApiKey } from "@office/core";
import type { Db } from "@office/db";

export type Principal =
  | { kind: "user"; userId: string; email: string; emailVerified: boolean }
  | { kind: "api_key"; keyId: string; tenantId: string; createdBy: string | null; scopes: ReadonlySet<string> };

export interface AuthDeps { db: Db; issuer: string; audience: string; pepper: string; jwks?: JWTVerifyGetKey }

export function createAuthenticator(d: AuthDeps) {
  const jwks = d.jwks ?? createRemoteJWKSet(new URL(`${d.issuer}/protocol/openid-connect/certs`));

  return async function authenticate(req: FastifyRequest): Promise<Principal> {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) throw unauthorized();
    const token = h.slice(7).trim();
    if (token.startsWith("ok_")) {
      const k = await verifyApiKey(d.db, d.pepper, token);
      return { kind: "api_key", keyId: k.id, tenantId: k.tenantId, createdBy: k.createdBy, scopes: k.scopes };
    }
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: d.issuer, audience: d.audience, algorithms: ["RS256", "ES256", "EdDSA"], clockTolerance: 30,
      }));
    } catch {
      throw unauthorized("Invalid token");
    }
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!payload.sub || !email) throw unauthorized("Token missing sub/email");
    if (payload.email_verified === false) throw unauthorized("Email not verified");
    const u = await upsertUser(d.db, { sub: payload.sub, email, name: typeof payload.name === "string" ? payload.name : undefined });
    if (u.status !== "active") throw unauthorized("User disabled");
    return { kind: "user", userId: u.id, email: u.email, emailVerified: payload.email_verified === true };
  };
}
