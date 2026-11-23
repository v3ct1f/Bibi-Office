import type { Identity } from "./identity.ts";

/**
 * The production sign-in service: Keycloak (realm "office"). Office talks to Keycloak's admin API with a service
 * account (client credentials) that may only manage users. Office never sees or stores a password except the
 * starting password a business owner types for a new colleague, which is passed straight on.
 *
 * Differences from the dev sign-in server:
 *  - Keycloak sends the "set your password" emails itself (its own SMTP settings in the realm), so `link` is
 *    always null and Office's emails go out without a password link.
 *  - Accounts made by someone else are never trusted: `emailVerified` stays false and the person must verify
 *    the email address (and choose their own password) before Keycloak lets them in. Otherwise a business owner
 *    could create an account for anyone's address, including the program owner's, and sign in as them.
 */
export interface KeycloakOptions {
  /** e.g. https://auth.example.com (no /realms path). */
  url: string;
  realm: string;
  /** Service-account client with realm-management roles manage-users and view-users. */
  clientId: string;
  clientSecret: string;
  /** The web app's client id in the realm, used for the redirect after the person sets a password. */
  webClientId?: string;
  /** Redirect addresses must start with this (the web app's address), or the redirect is left out. */
  appUrl?: string;
  log?: (e: unknown) => void;
}

const DAY = 86_400;

export function keycloakIdentity(o: Partial<KeycloakOptions>): Identity | null {
  if (!o.url || !o.clientId || !o.clientSecret) return null;
  const base = o.url.replace(/\/+$/, "");
  const realm = encodeURIComponent(o.realm || "office");
  const { clientId, clientSecret } = o as KeycloakOptions;
  const webClient = o.webClientId || "office-web";
  let cached: { token: string; until: number } | null = null;

  async function token(): Promise<string> {
    if (cached && cached.until > Date.now()) return cached.token;
    const r = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
      method: "POST", signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!r.ok) throw new Error(`Keycloak token request answered ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in?: number };
    cached = { token: j.access_token, until: Date.now() + Math.max(10, (j.expires_in ?? 60) - 20) * 1000 };
    return j.access_token;
  }

  async function admin(path: string, init: RequestInit = {}): Promise<Response> {
    const doFetch = async () => fetch(`${base}/admin/realms/${realm}${path}`, {
      ...init, signal: AbortSignal.timeout(10_000),
      headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers, authorization: `Bearer ${await token()}` },
    });
    let r = await doFetch();
    if (r.status === 401) { cached = null; r = await doFetch(); }
    return r;
  }

  const findUser = async (email: string): Promise<{ id: string } | null> => {
    const r = await admin(`/users?email=${encodeURIComponent(email)}&exact=true`);
    if (!r.ok) throw new Error(`Keycloak user search answered ${r.status}`);
    const list = (await r.json()) as { id: string; email?: string }[];
    return list.find((u) => u.email?.toLowerCase() === email) ?? null;
  };

  const idFromLocation = (r: Response) => r.headers.get("location")?.split("/").pop() ?? "";

  return {
    async createAccount(a) {
      const email = a.email.trim().toLowerCase();
      const r = await admin("/users", {
        method: "POST",
        body: JSON.stringify({
          username: email, email, firstName: a.name, enabled: true, emailVerified: false,
          requiredActions: ["VERIFY_EMAIL"],
          credentials: [{ type: "password", value: a.password, temporary: true }],
        }),
      });
      if (r.status === 409) return "exists";
      if (r.status !== 201) throw new Error(`Keycloak answered ${r.status} when creating an account`);
      const sub = idFromLocation(r);
      if (!sub) throw new Error("Keycloak did not say which account it created");
      return { sub };
    },

    async deleteAccount(sub) {
      const r = await admin(`/users/${encodeURIComponent(sub)}`, { method: "DELETE" });
      if (r.status !== 204 && r.status !== 404) throw new Error(`Keycloak answered ${r.status} when deleting an account`);
    },

    async passwordLink(emailIn, next) {
      try {
        const email = emailIn.trim().toLowerCase();
        let user = await findUser(email);
        // Forgot-password (no `next`) never creates accounts, so nobody can make us mail or register arbitrary addresses.
        if (!user && !next) return { link: null, hasPassword: false };
        if (!user) {
          const c = await admin("/users", { method: "POST", body: JSON.stringify({ username: email, email, enabled: true, emailVerified: false }) });
          if (c.status === 409) user = await findUser(email);
          else if (c.status === 201) user = { id: idFromLocation(c) };
          else throw new Error(`Keycloak answered ${c.status} when creating an account`);
          if (!user?.id) throw new Error("Keycloak did not say which account it created");
        }
        const cr = await admin(`/users/${encodeURIComponent(user.id)}/credentials`);
        if (!cr.ok) throw new Error(`Keycloak credentials lookup answered ${cr.status}`);
        const hasPassword = ((await cr.json()) as { type: string }[]).some((c) => c.type === "password");
        // An invitation to someone who already has a password needs no email from Keycloak.
        if (hasPassword && next) return { link: null, hasPassword: true };
        const q = new URLSearchParams({ client_id: webClient, lifespan: String(7 * DAY) });
        if (next && o.appUrl && next.startsWith(o.appUrl.replace(/\/+$/, "") + "/")) q.set("redirect_uri", next);
        const send = await admin(`/users/${encodeURIComponent(user.id)}/execute-actions-email?${q}`, {
          method: "PUT", body: JSON.stringify(hasPassword ? ["UPDATE_PASSWORD"] : ["VERIFY_EMAIL", "UPDATE_PASSWORD"]),
        });
        if (!send.ok) throw new Error(`Keycloak answered ${send.status} when sending the password email (is SMTP set in the realm?)`);
        return { link: null, hasPassword };
      } catch (e) {
        o.log?.(e);
        return null; // our own emails still go out, just without Keycloak's password email
      }
    },
  };
}
