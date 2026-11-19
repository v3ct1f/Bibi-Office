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
import { createAuthenticator } from "./plugins/auth.ts";
import { registerErrorHandler } from "./plugins/errors.ts";
import { makeTenantRunner } from "./tenant.ts";
import { registerRoutes } from "./routes/index.ts";
import { registerPlatformRoutes } from "./routes/platform.ts";
import type { FileDeps, ModuleRegistry, SecretBox } from "@office/platform";
import type { Config } from "./config.ts";

export interface AppDeps {
  db: Db;
  config: Pick<Config, "OIDC_ISSUER" | "OIDC_AUDIENCE" | "API_KEY_PEPPER" | "CORS_ORIGINS" | "RATE_LIMIT_PER_MIN" | "TRUST_PROXY" | "NODE_ENV">;
  jwks?: JWTVerifyGetKey;      // injectable for tests
  platform: { registry: ModuleRegistry; secrets: SecretBox; files: FileDeps };
  logger?: boolean | object;
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
  await app.register(cors, { origin: d.config.CORS_ORIGINS, credentials: false, exposedHeaders: ["x-request-id"] });
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
  app.addHook("preHandler", async (req) => {
    if (req.routeOptions.config?.auth === "authenticated") req.principal = await authenticate(req);
  });
  app.addHook("onSend", async (req, reply) => { reply.header("x-request-id", req.id); });

  app.get("/healthz", { logLevel: "warn" }, async () => ({ ok: true }));
  app.get("/readyz", { logLevel: "warn" }, async () => {
    await d.db.execute(sql`select 1`);
    return { ok: true };
  });

  const inTenant = makeTenantRunner(d.db);
  await app.register(registerRoutes, { prefix: "/api/v1", db: d.db, inTenant, pepper: d.config.API_KEY_PEPPER });
  await app.register(registerPlatformRoutes, {
    prefix: "/api/v1", db: d.db, inTenant, registry: d.platform.registry, secrets: d.platform.secrets, files: d.platform.files,
    requireHttps: d.config.NODE_ENV === "production",
  });
  return app;
}
