import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { keycloakIdentity } from "../src/keycloak.ts";

/** A pretend Keycloak: just enough of its token and admin API to see what Office sends. */
interface User { id: string; email: string; password?: boolean; body?: Record<string, unknown> }
let server: Server;
let url = "";
let users: User[] = [];
let calls: { method: string; path: string; body: unknown; auth?: string | undefined }[] = [];
let tokenCalls = 0;
let failEmail = false;
let expireOnce = false;

const readBody = (req: IncomingMessage) => new Promise<string>((res) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => res(s)); });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const u = new URL(req.url!, "http://x");
    const raw = await readBody(req);
    const send = (code: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (u.pathname === "/realms/office/protocol/openid-connect/token") {
      tokenCalls++;
      const f = new URLSearchParams(raw);
      if (f.get("grant_type") !== "client_credentials" || f.get("client_id") !== "office-admin" || f.get("client_secret") !== "s3cret") return send(401, {});
      return send(200, { access_token: `tok${tokenCalls}`, expires_in: 300 });
    }
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method!, path: u.pathname + u.search, body, auth: req.headers.authorization });
    if (expireOnce) { expireOnce = false; return send(401, {}); }
    const p = u.pathname.replace("/admin/realms/office", "");
    if (p === "/users" && req.method === "GET") {
      return send(200, users.filter((x) => x.email === u.searchParams.get("email")).map((x) => ({ id: x.id, email: x.email })));
    }
    if (p === "/users" && req.method === "POST") {
      if (users.some((x) => x.email === body.email)) return send(409, {});
      const id = `kc-${users.length + 1}`;
      users.push({ id, email: body.email, password: !!body.credentials, body });
      return send(201, undefined, { location: `${url}/admin/realms/office/users/${id}` });
    }
    const m = p.match(/^\/users\/([^/]+)\/(credentials|execute-actions-email)$/);
    if (m && m[2] === "credentials") return send(200, users.find((x) => x.id === m[1])?.password ? [{ type: "password" }] : []);
    if (m && m[2] === "execute-actions-email") return failEmail ? send(500, {}) : send(204);
    if (req.method === "DELETE" && p.startsWith("/users/")) {
      const id = p.split("/")[2];
      const known = users.some((x) => x.id === id);
      users = users.filter((x) => x.id !== id);
      return known ? send(204) : send(id === "boom" ? 500 : 404, {});
    }
    return send(404, {});
  }).listen(0);
  await new Promise((r) => server.once("listening", r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });
beforeEach(() => { users = []; calls = []; tokenCalls = 0; failEmail = false; expireOnce = false; });

const kc = (over = {}) => keycloakIdentity({ url, realm: "office", clientId: "office-admin", clientSecret: "s3cret", appUrl: "https://app.example.com", ...over })!;
const sent = () => calls.filter((c) => c.path.includes("execute-actions-email"));

describe("Keycloak sign-in service", () => {
  it("is off until URL, client and secret are all set", () => {
    expect(keycloakIdentity({ url })).toBeNull();
    expect(keycloakIdentity({})).toBeNull();
  });

  it("creates a colleague's account with a starting password they must change, and an unverified email", async () => {
    const r = await kc().createAccount({ email: "Sam@Example.com", name: "Sam", password: "starting-pass-1" });
    expect(r).toEqual({ sub: "kc-1" });
    expect(calls[0]).toMatchObject({ method: "POST", auth: "Bearer tok1" });
    expect(calls[0]!.body).toMatchObject({
      username: "sam@example.com", email: "sam@example.com", firstName: "Sam", enabled: true,
      emailVerified: false, requiredActions: ["VERIFY_EMAIL"], credentials: [{ type: "password", value: "starting-pass-1", temporary: true }],
    });
  });

  it("says 'exists' when the email already has an account, and fails loudly on other errors", async () => {
    const id = kc();
    await id.createAccount({ email: "sam@example.com", name: "Sam", password: "starting-pass-1" });
    expect(await id.createAccount({ email: "sam@example.com", name: "Sam", password: "another-pass-22" })).toBe("exists");
    await expect(kc({ clientSecret: "wrong" }).createAccount({ email: "x@example.com", name: "X", password: "starting-pass-1" })).rejects.toThrow(/token request answered 401/);
  });

  it("asks Keycloak to email a set-password link to an invited person without an account, and makes the account", async () => {
    const next = "https://app.example.com/invite/t1/abc";
    const r = await kc().passwordLink("New@Example.com", next);
    expect(r).toEqual({ link: null, hasPassword: false });
    expect(users[0]).toMatchObject({ email: "new@example.com" });
    expect(users[0]!.body).toMatchObject({ emailVerified: false });
    const s = sent()[0]!;
    expect(s.method).toBe("PUT");
    expect(s.body).toEqual(["VERIFY_EMAIL", "UPDATE_PASSWORD"]);
    const q = new URL(s.path, "http://x").searchParams;
    expect(q.get("client_id")).toBe("office-web");
    expect(q.get("redirect_uri")).toBe(next);
    expect(q.get("lifespan")).toBe(String(7 * 86_400));
  });

  it("leaves out a redirect that isn't on the web app's address", async () => {
    await kc().passwordLink("a@example.com", "https://evil.example.net/steal");
    expect(new URL(sent()[0]!.path, "http://x").searchParams.has("redirect_uri")).toBe(false);
  });

  it("sends nothing for an invitation to someone who already has a password", async () => {
    users.push({ id: "kc-9", email: "old@example.com", password: true });
    expect(await kc().passwordLink("old@example.com", "https://app.example.com/invite/t1/abc")).toEqual({ link: null, hasPassword: true });
    expect(sent()).toHaveLength(0);
  });

  it("forgot-password resets an existing account but never creates one", async () => {
    users.push({ id: "kc-9", email: "old@example.com", password: true });
    expect(await kc().passwordLink("old@example.com")).toEqual({ link: null, hasPassword: true });
    expect(sent()[0]!.body).toEqual(["UPDATE_PASSWORD"]);
    expect(await kc().passwordLink("nobody@example.com")).toEqual({ link: null, hasPassword: false });
    expect(users.map((u) => u.email)).toEqual(["old@example.com"]);
    expect(sent()).toHaveLength(1);
  });

  it("deletes an erased person's account; one that is already gone is fine; other errors are reported", async () => {
    users.push({ id: "kc-5", email: "gone@example.com" });
    await kc().deleteAccount!("kc-5");
    expect(users).toHaveLength(0);
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/admin/realms/office/users/kc-5" });
    await expect(kc().deleteAccount!("kc-5")).resolves.toBeUndefined();   // already gone (404)
    await expect(kc().deleteAccount!("boom")).rejects.toThrow(/answered 500/);
  });

  it("returns null (and logs) when Keycloak can't send the email, so Office's own emails still go out", async () => {
    failEmail = true;
    const errors: unknown[] = [];
    expect(await kc({ log: (e: unknown) => errors.push(e) }).passwordLink("a@example.com", "https://app.example.com/x")).toBeNull();
    expect(String(errors[0])).toMatch(/SMTP/);
  });

  it("reuses its access token, and asks for a new one if Keycloak says it expired", async () => {
    const id = kc();
    await id.passwordLink("a@example.com");
    await id.passwordLink("b@example.com");
    expect(tokenCalls).toBe(1);
    expireOnce = true;
    await id.passwordLink("c@example.com");
    expect(tokenCalls).toBe(2);
  });
});
