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
import { AppError, FixedRatesProvider, WORK_EMAIL, type RatesProvider } from "@office/core";
import { createAuthenticator } from "./plugins/auth.ts";
import { registerErrorHandler } from "./plugins/errors.ts";
import { makeTenantRunner } from "./tenant.ts";
import { registerRoutes } from "./routes/index.ts";
import { seedPlatformAdmins } from "@office/core";
import { registerPlatformRoutes } from "./routes/platform.ts";
import type { ModuleRegistry, SecretBox } from "@office/platform";
import type { Config } from "./config.ts";
import type { Mailer } from "./mail.ts";
import type { Identity } from "./identity.ts";
import type { Billing } from "./billing.ts";
import { enableGuard, workmailPayments } from "./addons.ts";
import { configureWorkmail, type WorkmailProvider } from "@office/module-workmail";
import { configureMail, type MailProvider } from "@office/module-mail";

export interface AppDeps {
  db: Db;
  config: Pick<Config, "OIDC_ISSUER" | "OIDC_AUDIENCE" | "API_KEY_PEPPER" | "CORS_ORIGINS" | "RATE_LIMIT_PER_MIN" | "TRUST_PROXY" | "NODE_ENV"> & Partial<Pick<Config, "APP_URL">>;
  /** Sends invitation emails; null or missing = show the link to copy instead. */
  mailer?: Mailer | null;
  /** Gives "set your password" links for emails; null or missing = emails go out without one. */
  identity?: Identity | null;
  /** Paid sign-up through Stripe; null or missing = sign-up page says "not open yet". */
  billing?: Billing | null;
  /** The company that sells domains and mailboxes for Work email; null or missing = the feature says "not set up". */
  workmailProvider?: WorkmailProvider | null;
  /** The mail server behind everyone's Mail inbox (IMAP/SMTP); null or missing = Mail says "not set up". */
  mailProvider?: MailProvider | null;
  /** Most mail one person keeps, and days before Trash/Spam are emptied (defaults: 2 GB, 30 days). */
  mailLimits?: { quotaBytes: number; trashDays: number };
  /** Where exchange rates come from (for showing prices in other currencies). Default: a fixed built-in table, no network. */
  rates?: RatesProvider;
  /** Receives public contact-form messages; without it (or without mail) the form is closed. */
  contactEmail?: string;
  jwks?: JWTVerifyGetKey;      // injectable for tests
  platform: { registry: ModuleRegistry; secrets: SecretBox };
  logger?: boolean | object;
  /** Failed sign-ins allowed per IP per minute (default 120). */
  authFailuresPerMin?: number;
  /** Program owners on first start (verified emails); after that they're managed in Program admin. */
  platformAdmins?: string[];
  /** Anyone signed in may create their own business (default false: only program owners). */
  selfSignup?: boolean;
  /**
   * Demo payments: a pretend checkout page instead of Stripe (local development and try-outs). Ignored in production
   * and whenever real Stripe billing is set up, so a live server can never take a pretend payment.
   */
  testPayments?: boolean;
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

  const appUrl = (d.config.APP_URL ?? d.config.CORS_ORIGINS[0] ?? "http://localhost:5173").replace(/\/+$/, "");
  configureWorkmail({ provider: d.workmailProvider ? withOurDomainPrice(d.workmailProvider) : null, payments: workmailPayments(d.db, d.billing ?? null, appUrl) });
  configureMail({ provider: d.mailProvider ?? null, ...(d.mailLimits ?? {}) });
  await seedPlatformAdmins(d.db, d.platformAdmins ?? []);
  const inTenant = makeTenantRunner(d.db, d.platform.registry.all().flatMap((m) => m.manifest.roles.viewer ?? []));
  await app.register(registerRoutes, {
    prefix: "/api/v1", db: d.db, inTenant, pepper: d.config.API_KEY_PEPPER, mailer: d.mailer ?? null, identity: d.identity ?? null, rates: d.rates ?? new FixedRatesProvider(),
    selfSignup: d.selfSignup ?? false, testPayments: !!d.testPayments && !d.billing && d.config.NODE_ENV !== "production", billing: d.billing ?? null, contactEmail: d.contactEmail, modules: d.platform,
    appUrl: (d.config.APP_URL ?? d.config.CORS_ORIGINS[0] ?? "http://localhost:5173").replace(/\/+$/, ""),
  });
  await app.register(registerPlatformRoutes, {
    prefix: "/api/v1", db: d.db, inTenant, registry: d.platform.registry, secrets: d.platform.secrets,
    requireHttps: d.config.NODE_ENV === "production", beforeEnable: enableGuard(d.db, d.billing ?? null),
  });
  return app;
}

/**
 * What a customer pays for a domain: never less than our standard price (core/plans.ts WORK_EMAIL.domainPerYear),
 * or the provider's own price when that is higher (some endings cost more). Everything else is the provider as is.
 * Assumes the provider quotes euros.
 */
function withOurDomainPrice(p: WorkmailProvider): WorkmailProvider {
  const floor = WORK_EMAIL.domainPerYear * 100;
  return Object.assign(Object.create(p) as WorkmailProvider, {
    searchDomains: async (q: string) => (await p.searchDomains(q)).map((x) => (x.priceCents === null ? x : { ...x, priceCents: Math.max(x.priceCents, floor) })),
  });
}
