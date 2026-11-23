import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { JWTVerifyGetKey } from "jose";
import { sql } from "drizzle-orm";
import { uuidv7, type Db } from "@office/db";
import { AppError } from "@office/core";
import { createAuthenticator } from "./plugins/auth.ts";
import { registerErrorHandler } from "./plugins/errors.ts";
import { makeTenantRunner } from "./tenant.ts";
import { registerRoutes } from "./routes/index.ts";
import { seedPlatformAdmins } from "@office/core";
import { registerPlatformRoutes } from "./routes/platform.ts";
import type { ModuleRegistry, SecretBox } from "@office/platform";
import type { Config } from "./config.ts";
import type { Mailer } from "./mail.ts";

export interface AppDeps {
  db: Db;
  config: Pick<Config, "OIDC_ISSUER" | "OIDC_AUDIENCE" | "API_KEY_PEPPER" | "CORS_ORIGINS" | "RATE_LIMIT_PER_MIN" | "TRUST_PROXY" | "NODE_ENV"> & Partial<Pick<Config, "APP_URL">>;
  /** Sends invitation emails; null or missing = show the link to copy instead. */
  mailer?: Mailer | null;
  jwks?: JWTVerifyGetKey;      // injectable for tests
  platform: { registry: ModuleRegistry; secrets: SecretBox };
  logger?: boolean | object;
  /** Failed sign-ins allowed per IP per minute (default 120). */
  authFailuresPerMin?: number;
  /** Program owners on first start (verified emails); after that they're managed in Program admin. */
  platformAdmins?: string[];
  /** Anyone signed in may create their own business (default false: only program owners). */
  selfSignup?: boolean;
}

export async function buildApp(d: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: d.logger ?? { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"] },
    genReqId: (req) => {
      const h = req.headers["x-request-id"];
      return typeof h === "string" && /^[\w-]{8,64}$/.test(h) ? h : uuidv7();
    },
    trustProxy: d.config.TRUST_PROXY,
    bodyLimit: 1_048_576,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(helmet, { contentSecurityPolicy: d.config.NODE_ENV === "production" ? undefined : false });
  await app.register(cors, {
    origin: d.config.CORS_ORIGINS, credentials: false, maxAge: 600,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "x-tenant-id", "x-request-id", "idempotency-key"],
    exposedHeaders: ["x-request-id"],
  });
  await app.register(rateLimit, {
    max: d.config.RATE_LIMIT_PER_MIN, timeWindow: "1 minute",
    keyGenerator: (req) => req.headers.authorization?.slice(-24) ?? req.ip, // per credential, else per IP
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Office API", version: "1.0.0" },
      components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // Deny by default: every /api route must declare config.auth.
  app.addHook("onRoute", (r) => {
    if (r.url.startsWith("/api/") && !r.config?.auth) throw new Error(`Route ${r.method} ${r.url} missing config.auth`);
  });

  const authenticate = createAuthenticator({
    db: d.db, issuer: d.config.OIDC_ISSUER, audience: d.config.OIDC_AUDIENCE, pepper: d.config.API_KEY_PEPPER,
    ...(d.jwks ? { jwks: d.jwks } : {}),
  });
  // The general rate limit is per credential, so random fake tokens would each get a fresh bucket.
  // Failed sign-ins are therefore also counted per IP, and an IP with too many is turned away for a minute.
  const failures = new Map<string, { n: number; until: number }>();
  const MAX_FAILURES = d.authFailuresPerMin ?? 120;
  app.addHook("preHandler", async (req) => {
    if (req.routeOptions.config?.auth !== "authenticated") return;
    const now = Date.now();
    const f = failures.get(req.ip);
    if (f && f.until > now && f.n >= MAX_FAILURES) throw new AppError(429, "too_many_failures", "Too many failed sign-in attempts. Try again in a minute.");
    try {
      req.principal = await authenticate(req);
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        if (failures.size > 50_000) for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
        const cur = f && f.until > now ? f : { n: 0, until: now + 60_000 };
        cur.n += 1;
        failures.set(req.ip, cur);
      }
      throw e;
    }
  });
  app.addHook("onSend", async (req, reply) => { reply.header("x-request-id", req.id); });

  app.get("/healthz", { logLevel: "warn" }, async () => ({ ok: true }));
  app.get("/readyz", { logLevel: "warn" }, async () => {
    await d.db.execute(sql`select 1`);
    return { ok: true };
  });

  await seedPlatformAdmins(d.db, d.platformAdmins ?? []);
  const inTenant = makeTenantRunner(d.db);
  await app.register(registerRoutes, {
    prefix: "/api/v1", db: d.db, inTenant, pepper: d.config.API_KEY_PEPPER, mailer: d.mailer ?? null,
    selfSignup: d.selfSignup ?? false, modules: d.platform,
    appUrl: (d.config.APP_URL ?? d.config.CORS_ORIGINS[0] ?? "http://localhost:5173").replace(/\/+$/, ""),
  });
  await app.register(registerPlatformRoutes, {
    prefix: "/api/v1", db: d.db, inTenant, registry: d.platform.registry, secrets: d.platform.secrets,
    requireHttps: d.config.NODE_ENV === "production",
  });
  return app;
}
