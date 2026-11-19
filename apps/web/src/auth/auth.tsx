import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import { config } from "../config.ts";

/**
 * OIDC authorization code + PKCE (S256) via oidc-client-ts. Tokens live in sessionStorage
 * (per tab, cleared on close); access tokens are renewed with the refresh token before expiry.
 */
export const userManager = new UserManager({
  authority: config.oidcIssuer,
  client_id: config.oidcClientId,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: "code",
  scope: "openid profile email",
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
});

export interface AuthState {
  user: User | null;
  loading: boolean;
  signIn(returnTo?: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    userManager.getUser().then((u) => { if (alive) { setUser(u && !u.expired ? u : null); setLoading(false); } });
    const loaded = (u: User) => setUser(u);
    const gone = () => setUser(null);
    userManager.events.addUserLoaded(loaded);
    userManager.events.addUserUnloaded(gone);
    userManager.events.addSilentRenewError(gone);
    return () => {
      alive = false;
      userManager.events.removeUserLoaded(loaded);
      userManager.events.removeUserUnloaded(gone);
      userManager.events.removeSilentRenewError(gone);
    };
  }, []);

  const value = useMemo<AuthState>(() => ({
    user, loading,
    signIn: (returnTo) => userManager.signinRedirect({ state: { returnTo: safeReturn(returnTo ?? location.pathname + location.search) } }),
    signOut: async () => {
      const u = await userManager.getUser();
      await userManager.removeUser();
      await userManager.signoutRedirect(u?.id_token ? { id_token_hint: u.id_token } : {}).catch(() => location.assign("/"));
    },
  }), [user, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

/** Only same-origin relative paths (no open redirects via state). */
export function safeReturn(p: unknown): string {
  return typeof p === "string" && p.startsWith("/") && !p.startsWith("//") && !p.startsWith("/auth/") ? p : "/";
}

/** Current access token, renewing if it is about to expire. */
export async function getAccessToken(): Promise<string | null> {
  let u = await userManager.getUser();
  if (u && (u.expires_in ?? 0) < 30) u = await userManager.signinSilent().catch(() => null);
  return u && !u.expired ? u.access_token : null;
}
