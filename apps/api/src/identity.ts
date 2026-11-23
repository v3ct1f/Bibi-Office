/**
 * The sign-in service's admin side: Office asks it for one-time "set your password" links, which it puts in
 * emails (invitations, new program owners, forgot password). Office itself never sees or stores passwords.
 * Locally this is the dev sign-in server (scripts/dev-oidc.ts); in production a Keycloak adapter goes here.
 */
export interface Identity {
  /** A one-time link to set (or reset) the password for this email; `next` is where to go afterwards. */
  passwordLink(email: string, next?: string): Promise<{ link: string | null; hasPassword: boolean } | null>;
}

/** IDP_ADMIN_URL (e.g. http://localhost:8081/dev-admin) + IDP_ADMIN_SECRET; null when not set up. */
export function devIdentity(url: string | undefined, secret: string | undefined, log?: (e: unknown) => void): Identity | null {
  if (!url || !secret) return null;
  return {
    async passwordLink(email, next) {
      try {
        const r = await fetch(`${url.replace(/\/+$/, "")}/password-link`, {
          method: "POST", headers: { "content-type": "application/json", "x-dev-admin-secret": secret },
          body: JSON.stringify({ email, ...(next ? { next } : {}) }), signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) throw new Error(`sign-in service answered ${r.status}`);
        return (await r.json()) as { link: string | null; hasPassword: boolean };
      } catch (e) {
        log?.(e);
        return null; // emails still go out, just without the password link
      }
    },
  };
}
