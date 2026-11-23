import { createDb } from "@office/db";
import { SecretBox } from "@office/platform";
import { createRegistry } from "@office/modules";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { smtpMailer } from "./mail.ts";
import { devIdentity } from "./identity.ts";
import { stripeBilling } from "./billing.ts";
import { keycloakIdentity } from "./keycloak.ts";

const config = loadConfig();
const { db, close } = createDb(config.DATABASE_URL_APP, { max: 20 });
const app = await buildApp({
  db, config, mailer: smtpMailer(config.MAIL_SMTP_URL, config.MAIL_FROM),
  identity: keycloakIdentity({
    url: config.KEYCLOAK_URL, realm: config.KEYCLOAK_REALM, clientId: config.KEYCLOAK_ADMIN_CLIENT_ID, clientSecret: config.KEYCLOAK_ADMIN_CLIENT_SECRET,
    appUrl: config.APP_URL ?? config.CORS_ORIGINS[0], log: (e) => console.warn("sign-in service:", e),
  }) ?? devIdentity(config.IDP_ADMIN_URL, config.IDP_ADMIN_SECRET, (e) => console.warn("password link failed:", e)),
  billing: stripeBilling({
    secretKey: config.STRIPE_SECRET_KEY, webhookSecret: config.STRIPE_WEBHOOK_SECRET, priceId: config.STRIPE_PRICE_ID, label: config.STRIPE_PRICE_LABEL,
  }),
  platformAdmins: config.PLATFORM_ADMIN_EMAILS, selfSignup: config.SELF_SIGNUP, platform: { registry: createRegistry(), secrets: new SecretBox(config.SECRETS_KEY) },
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
