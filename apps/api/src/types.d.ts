import "fastify";
import type { Principal } from "./plugins/auth.ts";

declare module "fastify" {
  interface FastifyRequest { principal?: Principal }
  interface FastifyContextConfig {
    /** Required on every /api route. "public" skips auth. */
    auth?: "public" | "authenticated";
  }
}
