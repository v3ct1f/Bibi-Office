import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL_APP: z.string().url(),
  OIDC_ISSUER: z.string().url(),
  OIDC_AUDIENCE: z.string().min(1),
  API_KEY_PEPPER: z.string().min(32, "API_KEY_PEPPER must be >= 32 chars"),
  SECRETS_KEY: z.string().refine((s) => Buffer.from(s, "base64").length === 32, "SECRETS_KEY must be 32 bytes base64"),
  CORS_ORIGINS: z.string().default("").transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().default(600),
  TRUST_PROXY: z.stringbool().default(false),
  /** Address of the web app, for links in emails (invitations). Defaults to the first CORS origin. */
  APP_URL: z.url().optional(),
  /** Platform email for invitations, e.g. smtps://user:pass@smtp.example.com:465. Without it, invite links are shown to copy. */
  MAIL_SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
});
export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    console.error("Invalid configuration:", z.prettifyError(r.error));
    process.exit(1);
  }
  return r.data;
}
