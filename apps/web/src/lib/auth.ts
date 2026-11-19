import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

export interface Auth {
  /** Returns a valid access token or null (not signed in). */
  token(): Promise<string | null>;
  login(returnTo?: string): Promise<void>;
  logout(): Promise<void>;
  /** Completes the redirect; returns path to go back to. */
  callback(): Promise<string>;
  profile(): Promise<{ email?: string | undefined; name?: string | undefined } | null>;
}

/**
 * OIDC Authorization Code + PKCE (Keycloak). Tokens live in sessionStorage (tab-scoped,
 * cleared on close) and refresh silently with the refresh token. No tokens in localStorage.
 */
export function createOidcAuth(): Auth {
  const origin = window.location.origin;
  const um = new UserManager({
    authority: import.meta.env.VITE_OIDC_AUTHORITY ?? "http://localhost:8080/realms/office",
    client_id: import.meta.env.VITE_OIDC_CLIENT_ID ?? "office-web",
    redirect_uri: `${origin}/auth/callback`,
    post_logout_redirect_uri: origin,
    response_type: "code",
    scope: "openid profile email",
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });
  const valid = (u: User | null) => (u && !u.expired ? u : null);
  return {
    async token() {
      let u = valid(await um.getUser());
      if (!u && (await um.getUser())?.refresh_token) u = await um.signinSilent().catch(() => null);
      return u?.access_token ?? null;
    },
    login: (returnTo = window.location.pathname) => um.signinRedirect({ state: { returnTo } }),
    logout: () => um.signoutRedirect(),
    async callback() {
      const u = await um.signinRedirectCallback();
      const r = (u.state as { returnTo?: string } | undefined)?.returnTo;
      return r && r.startsWith("/") && !r.startsWith("//") ? r : "/";
    },
    async profile() {
      const u = await um.getUser();
      return u ? { email: u.profile.email, name: u.profile.name } : null;
    },
  };
}

/** E2E only: token injected by Playwright. Compiled out unless built with --mode e2e. */
function createE2EAuth(): Auth {
  const w = window as unknown as { __OFFICE_E2E_TOKEN__?: string; __OFFICE_E2E_EMAIL__?: string };
  return {
    token: async () => w.__OFFICE_E2E_TOKEN__ ?? null,
    login: async () => { throw new Error("e2e: no token injected"); },
    logout: async () => { delete w.__OFFICE_E2E_TOKEN__; window.location.href = "/"; },
    callback: async () => "/",
    profile: async () => ({ email: w.__OFFICE_E2E_EMAIL__ }),
  };
}

export const auth: Auth = import.meta.env.MODE === "e2e" ? createE2EAuth() : createOidcAuth();
