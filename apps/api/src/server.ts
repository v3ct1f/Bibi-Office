import { createDb } from "@office/db";
import { SecretBox } from "@office/platform";
import { createRegistry } from "@office/modules";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { smtpMailer } from "./mail.ts";
import { devIdentity } from "./identity.ts";
import { stripeBilling } from "./billing.ts";
import { keycloakIdentity } from "./keycloak.ts";
import { scheduleErasure } from "./erasure.ts";
import { fakeProvider } from "@office/module-workmail";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL_APP, { max: 20 });
const identity = keycloakIdentity({
    url: config.KEYCLOAK_URL, realm: config.KEYCLOAK_REALM, clientId: config.KEYCLOAK_ADMIN_CLIENT_ID, clientSecret: config.KEYCLOAK_ADMIN_CLIENT_SECRET,
    appUrl: config.APP_URL ?? config.CORS_ORIGINS[0], log: (e) => console.warn("sign-in service:", e),
  }) ?? devIdentity(config.IDP_ADMIN_URL, config.IDP_ADMIN_SECRET, (e) => console.warn("password link failed:", e));
const app = await buildApp({
  db, config, mailer: smtpMailer(config.MAIL_SMTP_URL, config.MAIL_FROM), identity,
  billing: stripeBilling({
    secretKey: config.STRIPE_SECRET_KEY, webhookSecret: config.STRIPE_WEBHOOK_SECRET, priceId: config.STRIPE_PRICE_ID, label: config.STRIPE_PRICE_LABEL,
    workmailPriceId: config.STRIPE_WORKMAIL_PRICE_ID, workmailLabel: config.STRIPE_WORKMAIL_PRICE_LABEL,
  }),
  contactEmail: config.CONTACT_EMAIL,
  workmailProvider: (config.WORKMAIL_PROVIDER ?? (config.NODE_ENV === "production" ? "off" : "fake")) === "fake" ? fakeProvider() : null,
  platformAdmins: config.PLATFORM_ADMIN_EMAILS, selfSignup: config.SELF_SIGNUP, testPayments: config.TEST_PAYMENTS, platform: { registry: createRegistry(), secrets: new SecretBox(config.SECRETS_KEY) },
});

const shutdown = async (sig: string) => {
  app.log.info({ sig }, "shutting down");
  await app.close();
  await close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.PORT, host: config.HOST });
// Businesses deleted 30+ days ago, or whose paid subscription ended 90+ days ago, are erased for good (see erasure.ts).
scheduleErasure(db, identity, app.log);
