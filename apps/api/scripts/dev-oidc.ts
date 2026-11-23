/**
 * Dev-only OIDC provider (authorization code + PKCE S256, refresh tokens).
 * Lets the web app and E2E tests run without Docker/Keycloak. Keycloak-shaped paths so
 * the API's JWKS lookup (`${issuer}/protocol/openid-connect/certs`) works unchanged.
 *
 *   pnpm dev:oidc     -> issuer http://localhost:8081/realms/office
 *
 * Two modes:
 *  - passwords (default): real local accounts. People sign in with email + password; a password is set
 *    through a one-time "set your password" link that Office emails (invitations, new owners, forgot password).
 *    Accounts and the signing key are kept in DEV_OIDC_DATA (default <repo>/.dev-accounts.json, git-ignored).
 *  - DEV_OIDC_PASSWORDS=off: anyone can sign in as any email (used by the automated browser tests).
 * Office asks for set-password links at POST /dev-admin/password-link with the shared DEV_OIDC_ADMIN_SECRET.
 *
 * NEVER run this outside local development: production uses a real identity provider (Keycloak).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { exportJWK, exportPKCS8, generateKeyPair, importPKCS8, importSPKI, exportSPKI, SignJWT } from "jose";

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
const PASSWORDS = (process.env.DEV_OIDC_PASSWORDS ?? "on") !== "off";
const ADMIN_SECRET = process.env.DEV_OIDC_ADMIN_SECRET ?? "dev-idp-admin-secret";
const DATA = process.env.DEV_OIDC_DATA ?? fileURLToPath(new URL("../../../.dev-accounts.json", import.meta.url));
const LINK_DAYS = 7;
const MIN_PASSWORD = 10;

// ───── Stored data: accounts, one-time links and the signing key (so sign-ins survive restarts) ─────
interface Account { name: string; salt: string; hash: string; updatedAt: string }
interface Store { key?: { pkcs8: string; spki: string }; accounts: Record<string, Account>; links: Record<string, { email: string; exp: number; next?: string }> }
const store: Store = PASSWORDS && existsSync(DATA) ? JSON.parse(readFileSync(DATA, "utf8")) as Store : { accounts: {}, links: {} };
store.accounts ??= {}; store.links ??= {};
const save = () => {
  if (!PASSWORDS) return;
  const tmp = `${DATA}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 1), { mode: 0o600 });
  renameSync(tmp, DATA);
};

type Key = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let publicKey: Key, privateKey: Key;
if (store.key) {
  privateKey = await importPKCS8(store.key.pkcs8, "RS256", { extractable: true });
  publicKey = await importSPKI(store.key.spki, "RS256", { extractable: true });
} else {
  ({ publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true }));
  store.key = { pkcs8: await exportPKCS8(privateKey), spki: await exportSPKI(publicKey) };
  save();
}
const jwk = { ...(await exportJWK(publicKey)), kid: "dev-1", alg: "RS256", use: "sig" };

const hashPassword = (pw: string, salt: string) => scryptSync(pw, Buffer.from(salt, "base64"), 64, { N: 16384, r: 8, p: 1 }).toString("base64");
function checkPassword(email: string, pw: string) {
  const a = store.accounts[email];
  // Same work whether or not the account exists, so timing doesn't reveal who has one.
  const salt = a?.salt ?? "AAAAAAAAAAAAAAAAAAAAAA==";
  const got = Buffer.from(hashPassword(pw, salt), "base64");
  const want = a ? Buffer.from(a.hash, "base64") : Buffer.alloc(64);
  return !!a && timingSafeEqual(got, want);
}
const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

// Failed sign-ins: 5 per email per 15 minutes, then wait.
const failures = new Map<string, { n: number; until: number }>();
const locked = (email: string) => { const f = failures.get(email); return !!f && f.n >= 5 && f.until > Date.now(); };
const failed = (email: string) => {
  const f = failures.get(email);
  const fresh = !f || f.until < Date.now();
  failures.set(email, { n: fresh ? 1 : f!.n + 1, until: fresh ? Date.now() + 15 * 60_000 : f!.until });
};

/** authTime: when the password was typed (seconds); kept across refreshes, like a real OIDC provider's auth_time. */
interface Grant { email: string; name: string; nonce?: string | undefined; authTime: number }
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
  const profile = { email: g.email, email_verified: true, name: g.name, preferred_username: g.email, auth_time: g.authTime };
  const rt = randomBytes(32).toString("base64url");
  refresh.set(rt, { email: g.email, name: g.name, authTime: g.authTime });
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

const STYLE = `<style>body{font:15px system-ui;background:#f4f4f5;display:grid;place-items:center;min-height:100vh;margin:0}
form,.box{background:#fff;padding:28px;border-radius:12px;box-shadow:0 1px 3px #0002;width:min(340px,90vw);display:grid;gap:12px}
input,button{font:inherit;padding:9px 11px;border-radius:8px;border:1px solid #d4d4d8;width:100%;box-sizing:border-box}
button,.btn{background:#18181b;color:#fff;border:0;cursor:pointer;text-align:center;text-decoration:none;padding:9px 11px;border-radius:8px}
p{margin:0;color:#71717a;font-size:13px}.err{color:#b91c1c}a{color:#4f46e5}</style>`;
const page = (title: string, inner: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">${STYLE}</head><body>${inner}</body></html>`;

/** Email + password sign-in (passwords mode). appOrigin comes from the already-checked redirect_uri. */
const passwordLoginPage = (q: URLSearchParams, appOrigin: string, error?: string, email = q.get("login_hint") ?? "") => page("Sign in to Office", `
<form method="post" action="${P}/auth"><strong>${q.get("prompt") === "login" ? "Confirm it's you" : "Sign in to Office"}</strong>
${q.get("prompt") === "login" && !error ? `<p>For your security, enter your password again to continue.</p>` : ""}
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
${[...q].filter(([k]) => !["email", "password", "name"].includes(k)).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}
<label>Email<br><input name="email" type="email" required autocomplete="username" value="${esc(email)}" autofocus></label>
<label>Password<br><input name="password" type="password" required autocomplete="current-password"></label>
<button type="submit">Sign in</button>
<p><a href="${esc(appOrigin)}/forgot-password">Forgot your password or never set one?</a></p></form>`);

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
      const appOrigin = new URL(redirectUri).origin;
      let name = (q.get("name") ?? email).slice(0, 200);
      if (PASSWORDS) {
        if (req.method !== "POST" || !email) return send(res, 200, passwordLoginPage(q, appOrigin));
        if (locked(email)) return send(res, 429, passwordLoginPage(q, appOrigin, "Too many tries. Wait 15 minutes, or set a new password with the link below.", email));
        if (!checkPassword(email, q.get("password") ?? "")) {
          failed(email);
          return send(res, 401, passwordLoginPage(q, appOrigin, "That email and password don't match. If you've never set a password, use the link below.", email));
        }
        failures.delete(email);
        name = store.accounts[email]!.name || email;
      } else if (req.method !== "POST" || !email) return send(res, 200, loginPage(q));
      const code = randomBytes(24).toString("base64url");
      codes.set(code, {
        email, name, nonce: q.get("nonce") ?? undefined, authTime: Math.floor(Date.now() / 1000),
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

    // ───── Office asks for a one-time "set your password" link (shared secret, local only) ─────
    if (url.pathname === "/dev-admin/password-link" && req.method === "POST") {
      const given = Buffer.from(String(req.headers["x-dev-admin-secret"] ?? ""));
      const want = Buffer.from(ADMIN_SECRET);
      if (given.length !== want.length || !timingSafeEqual(given, want)) return send(res, 401, { error: "unauthorized" });
      let raw = ""; for await (const c of req) { raw += c; if (raw.length > 8192) throw new Error("body too large"); }
      const { email: e, next } = JSON.parse(raw) as { email?: string; next?: string };
      const email = String(e ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: "invalid email" });
      if (!PASSWORDS) return send(res, 200, { link: null, hasPassword: true });
      // A new link replaces older unused ones for the same address; expired links are cleaned up.
      for (const [h, l] of Object.entries(store.links)) if (l.email === email || l.exp < Date.now()) delete store.links[h];
      const token = randomBytes(32).toString("base64url");
      store.links[tokenHash(token)] = { email, exp: Date.now() + LINK_DAYS * 86_400_000, ...(next && okRedirect(next) ? { next } : {}) };
      save();
      return send(res, 200, { link: `${BASE}/set-password?token=${token}`, hasPassword: !!store.accounts[email] });
    }

    // ───── Set (or reset) a password with a one-time link ─────
    if (url.pathname === "/set-password") {
      const f = req.method === "POST" ? await body(req) : url.searchParams;
      const token = f.get("token") ?? "";
      const l = store.links[tokenHash(token)];
      const app = REDIRECT_PREFIXES[0]!.replace(/\/$/, "");
      if (!l || l.exp < Date.now()) {
        return send(res, 400, page("Link expired", `<div class="box"><strong>This link doesn't work any more</strong>
<p>It was already used, replaced by a newer one, or is older than ${LINK_DAYS} days.</p>
<a class="btn" href="${esc(app)}/forgot-password">Get a new link</a></div>`));
      }
      const acct = store.accounts[l.email];
      const form = (error?: string) => page("Set your password", `
<form method="post" action="/set-password"><strong>${acct ? "Choose a new password" : "Set your password"}</strong>
<p>For <b>${esc(l.email)}</b>. At least ${MIN_PASSWORD} characters.</p>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ""}
<input type="hidden" name="token" value="${esc(token)}">
<input type="email" name="username" value="${esc(l.email)}" autocomplete="username" hidden>
<label>Your name<br><input name="name" required maxlength="200" autocomplete="name" value="${esc(acct?.name ?? "")}"></label>
<label>New password<br><input name="password" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password"></label>
<label>Repeat password<br><input name="password2" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password"></label>
<button type="submit">Save password</button></form>`);
      if (req.method !== "POST") return send(res, 200, form());
      const pw = f.get("password") ?? "", name = (f.get("name") ?? "").trim().slice(0, 200);
      if (!name) return send(res, 400, form("Enter your name."));
      if (pw.length < MIN_PASSWORD) return send(res, 400, form(`Use at least ${MIN_PASSWORD} characters.`));
      if (pw !== f.get("password2")) return send(res, 400, form("The two passwords are different."));
      const salt = randomBytes(16).toString("base64");
      store.accounts[l.email] = { name, salt, hash: hashPassword(pw, salt), updatedAt: new Date().toISOString() };
      delete store.links[tokenHash(token)];
      for (const [rt, g] of refresh) if (g.email === l.email) refresh.delete(rt); // sign out other sessions
      failures.delete(l.email);
      save();
      const next = l.next ?? `${app}/`;
      return send(res, 200, page("Password saved", `<div class="box"><strong>Password saved</strong>
<p>You can now sign in to Office as <b>${esc(l.email)}</b> with your new password.</p>
<a class="btn" href="${esc(next)}">Continue to Office</a></div>`));
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

server.listen(PORT, "127.0.0.1", () => console.log(`dev-oidc: issuer ${ISSUER} (dev only, ${PASSWORDS ? `password accounts: ${Object.keys(store.accounts).length}` : "accepts any email"})`));
