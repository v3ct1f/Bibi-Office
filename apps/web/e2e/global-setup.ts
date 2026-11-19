import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createTestDatabase } from "@office/testing";
import { installModules } from "@office/platform";
import { createRegistry } from "@office/modules";
import { startFakeClaude } from "../../../modules/ai/tests/fake-claude.ts";

const JWKS_PORT = 3998, API_PORT = 3999, WEB_PORT = 4173;
const ISSUER = `http://127.0.0.1:${JWKS_PORT}/realms/e2e`;
export const STATE_FILE = new URL("./.state.json", import.meta.url);

async function waitFor(url: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}

export default async function globalSetup() {
  const db = await createTestDatabase();
  await installModules(db.ownerUrl, createRegistry(), () => {});
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "e2e", alg: "RS256", use: "sig" };
  const jwks: Server = createServer((_q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((r) => jwks.listen(JWKS_PORT, "127.0.0.1", r));

  const token = (sub: string) => new SignJWT({ email: `${sub}@example.com`, name: sub, email_verified: true })
    .setProtectedHeader({ alg: "RS256", kid: "e2e" }).setIssuer(ISSUER).setAudience("office-api")
    .setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(privateKey);
  const inboundSecret = randomBytes(24).toString("hex");
  const claude = await startFakeClaude();   // stand-in for the Claude API; E2E never calls the real one
  writeFileSync(STATE_FILE, JSON.stringify({ alice: await token("alice"), bob: await token("bob"), inboundSecret, api: `http://127.0.0.1:${API_PORT}`, ownerUrl: db.ownerUrl }));

  const env = {
    ...process.env, NODE_ENV: "test", PORT: String(API_PORT), HOST: "127.0.0.1",
    DATABASE_URL_APP: db.appUrl, OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: "office-api",
    API_KEY_PEPPER: randomBytes(32).toString("hex"), SECRETS_KEY: randomBytes(32).toString("base64"),
    FILES_DRIVER: "fs", FILES_DIR: mkdtempSync(join(tmpdir(), "office-e2e-files-")),
    MAIL_FROM: "Office <no-reply@e2e.test>", INBOUND_MAIL_DOMAIN: "in.e2e.test", INBOUND_MAIL_SECRET: inboundSecret, APP_URL: `http://127.0.0.1:${WEB_PORT}`,
    ANTHROPIC_BASE_URL: claude.url,
    RATE_LIMIT_PER_MIN: "5000",   // the whole suite signs in as one user; production default stays 600
  };
  const procs: ChildProcess[] = [
    spawn("node", ["--import", "tsx", "../api/src/server.ts"], { env, stdio: ["ignore", "ignore", "inherit"] }),
    spawn("node", ["node_modules/vite/bin/vite.js", "preview", "--mode", "e2e", "--outDir", "dist-e2e", "--host", "127.0.0.1"], {
      env: { ...process.env, OFFICE_API_PROXY: `http://127.0.0.1:${API_PORT}`, PREVIEW_PORT: String(WEB_PORT) }, stdio: "ignore",
    }),
  ];
  await waitFor(`http://127.0.0.1:${API_PORT}/healthz`);
  await waitFor(`http://127.0.0.1:${WEB_PORT}/`);

  return async () => {
    await Promise.all(procs.map((p) => new Promise<void>((r) => {
      if (p.exitCode !== null) return r();
      p.once("exit", () => r());
      p.kill("SIGTERM");
      setTimeout(() => { p.kill("SIGKILL"); r(); }, 5000);
    })));
    jwks.close();
    await claude.close();
    await db.drop();
  };
}
