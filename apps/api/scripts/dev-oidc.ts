/**
 * Dev-only OIDC provider (authorization code + PKCE S256, refresh tokens).
 * Lets the web app and E2E tests run without Docker/Keycloak. Keycloak-shaped paths so
 * the API's JWKS lookup (`${issuer}/protocol/openid-connect/certs`) works unchanged.
 *
 *   pnpm dev:oidc     -> issuer http://localhost:8081/realms/office
 *
 * Anyone can sign in as any email: NEVER run this outside local development.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

if (process.env.NODE_ENV === "production") {
  console.error("dev-oidc refuses to run with NODE_ENV=production");
  process.exit(1);
}

const PORT = Number(process.env.DEV_OIDC_PORT ?? 8081);
const BASE = `http://localhost:${PORT}`;
const ISSUER = `${BASE}/realms/office`;
const P = "/realms/office/protocol/openid-connect";
const CLIENT_ID = "office-web";
const AUDIENCE = process.env.OIDC_AUDIENCE ?? "office-api";
const REDIRECT_PREFIXES = (process.env.DEV_OIDC_REDIRECTS ?? "http://localhost:5173/,http://127.0.0.1:5173/,http://localhost:4173/,http://127.0.0.1:4173/")
  .split(",").map((s) => s.trim()).filter(Boolean);
const TTL = Number(process.env.DEV_OIDC_TTL ?? 300);

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = { ...(await exportJWK(publicKey)), kid: "dev-1", alg: "RS256", use: "sig" };

interface Grant { email: string; name: string; nonce?: string | undefined }
const codes = new Map<string, Grant & { challenge: string; redirectUri: string; exp: number }>();
const refresh = new Map<string, Grant>();

const sub = (email: string) => `dev-${createHash("sha256").update(email).digest("hex").slice(0, 24)}`;
const okRedirect = (u: string) => REDIRECT_PREFIXES.some((p) => u.startsWith(p));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function tokens(g: Grant) {
  const s = sub(g.email);
  const sign = (claims: Record<string, unknown>, aud: string) => new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "dev-1" }).setIssuer(ISSUER).setAudience(aud).setSubject(s)
    .setIssuedAt().setExpirationTime(`${TTL}s`).sign(privateKey);
  const profile = { email: g.email, email_verified: true, name: g.name, preferred_username: g.email };
  const rt = randomBytes(32).toString("base64url");
  refresh.set(rt, { email: g.email, name: g.name });
  return {
    access_token: await sign({ ...profile, azp: CLIENT_ID, scope: "openid profile email" }, AUDIENCE),
    id_token: await sign({ ...profile, ...(g.nonce ? { nonce: g.nonce } : {}) }, CLIENT_ID),
    refresh_token: rt, token_type: "Bearer", expires_in: TTL, scope: "openid profile email",
  };
}

async function body(req: IncomingMessage): Promise<URLSearchParams> {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > 65_536) throw new Error("body too large"); }
  return new URLSearchParams(raw);
}

function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  const isHtml = typeof data === "string";
  res.writeHead(status, {
    "content-type": isHtml ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store", "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, authorization", ...headers,
  });
  res.end(isHtml ? data : JSON.stringify(data));
}

const loginPage = (q: URLSearchParams) => `<!doctype html><html><head><meta charset="utf-8"><title>Dev sign-in</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:15px system-ui;background:#f4f4f5;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#fff;padding:28px;border-radius:12px;box-shadow:0 1px 3px #0002;width:min(340px,90vw);display:grid;gap:12px}
input,button{font:inherit;padding:9px 11px;border-radius:8px;border:1px solid #d4d4d8}button{background:#18181b;color:#fff;border:0;cursor:pointer}
p{margin:0;color:#71717a;font-size:13px}</style></head><body>
<form method="post" action="${P}/auth"><strong>Dev sign-in</strong><p>Local OIDC stub. Any email works.</p>
${[...q].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}
<label>Email<br><input name="email" type="email" required value="dev@example.com" style="width:100%;box-sizing:border-box"></label>
<label>Name<br><input name="name" value="Dev User" style="width:100%;box-sizing:border-box"></label>
<button type="submit">Sign in</button></form></body></html>`;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", BASE);
    if (req.method === "OPTIONS") return send(res, 204, "");

    if (url.pathname === "/realms/office/.well-known/openid-configuration") {
      return send(res, 200, {
        issuer: ISSUER, authorization_endpoint: `${BASE}${P}/auth`, token_endpoint: `${BASE}${P}/token`,
        jwks_uri: `${BASE}${P}/certs`, end_session_endpoint: `${BASE}${P}/logout`, userinfo_endpoint: `${BASE}${P}/userinfo`,
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"], id_token_signing_alg_values_supported: ["RS256"],
        subject_types_supported: ["public"], scopes_supported: ["openid", "profile", "email", "offline_access"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === `${P}/certs`) return send(res, 200, { keys: [jwk] });

    if (url.pathname === `${P}/auth`) {
      const q = req.method === "POST" ? await body(req) : url.searchParams;
      const redirectUri = q.get("redirect_uri") ?? "";
      if (q.get("client_id") !== CLIENT_ID || !okRedirect(redirectUri)) return send(res, 400, "invalid client_id or redirect_uri");
      if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) {
        return send(res, 400, "authorization code flow with PKCE S256 required");
      }
      const email = (q.get("email") ?? "").trim().toLowerCase();
      if (req.method !== "POST" || !email) return send(res, 200, loginPage(q));
      const code = randomBytes(24).toString("base64url");
      codes.set(code, {
        email, name: (q.get("name") ?? email).slice(0, 200), nonce: q.get("nonce") ?? undefined,
        challenge: q.get("code_challenge")!, redirectUri, exp: Date.now() + 60_000,
      });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      if (q.get("state")) back.searchParams.set("state", q.get("state")!);
      back.searchParams.set("iss", ISSUER);
      return send(res, 302, "", { location: back.toString() });
    }

    if (url.pathname === `${P}/token` && req.method === "POST") {
      const f = await body(req);
      if (f.get("client_id") !== CLIENT_ID) return send(res, 401, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code") {
        const c = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? "");
        const verifier = f.get("code_verifier") ?? "";
        const ok = c && c.exp > Date.now() && c.redirectUri === f.get("redirect_uri")
          && createHash("sha256").update(verifier).digest("base64url") === c.challenge;
        if (!ok) return send(res, 400, { error: "invalid_grant" });
        return send(res, 200, await tokens(c));
      }
      if (f.get("grant_type") === "refresh_token") {
        const g = refresh.get(f.get("refresh_token") ?? "");
        if (!g) return send(res, 400, { error: "invalid_grant" });
        refresh.delete(f.get("refresh_token")!);
        return send(res, 200, await tokens(g));
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }

    if (url.pathname === `${P}/logout`) {
      const to = url.searchParams.get("post_logout_redirect_uri");
      return to && okRedirect(to) ? send(res, 302, "", { location: to }) : send(res, 200, "Signed out.");
    }
    send(res, 404, { error: "not_found" });
  } catch (e) {
    send(res, 400, { error: "invalid_request", error_description: (e as Error).message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`dev-oidc: issuer ${ISSUER} (dev only, accepts any email)`));
