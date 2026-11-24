import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Building2, LogIn, MailQuestion } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, Field, Input, Select, Spinner } from "@office/ui";
import { safeReturn, useAuth, userManager } from "../auth/auth.tsx";
import { errorMessage, request } from "../api/client.ts";
import type { TenantRef } from "../api/types.ts";
import { useMe } from "../shell/AppShell.tsx";
import { REGIONS, REGION_HINT } from "../lib/regions.ts";

const LAST = "office.lastTenant";
export const rememberTenant = (slug: string) => { try { localStorage.setItem(LAST, slug); } catch { /* ignore */ } };
const lastTenant = () => { try { return localStorage.getItem(LAST); } catch { return null; } };

export const FullPage = ({ children }: { children: ReactNode }) => (
  <div className="grid min-h-screen place-items-center bg-muted/40 p-4">{children}</div>
);
export const Loading = () => <FullPage><Spinner /></FullPage>;

export function SignIn() {
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <FullPage>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-2 size-10" />
          <CardTitle className="text-lg">Welcome to Office</CardTitle>
          <CardDescription>Sign in with your organization account to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button className="w-full" size="lg" loading={busy} onClick={() => { setBusy(true); void signIn().catch(() => setBusy(false)); }}>
            <LogIn /> Sign in
          </Button>
          <Button asChild variant="link" className="mt-2 w-full text-muted-foreground"><a href="/forgot-password">Forgot your password or never set one?</a></Button>
          <p className="mt-3 text-center text-xs text-muted-foreground"><a className="underline" href="/terms">Terms</a> · <a className="underline" href="/privacy">Privacy Policy</a></p>
        </CardContent>
      </Card>
    </FullPage>
  );
}

/** Renders children only for signed-in users; otherwise the sign-in screen. */
export function Authed({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <SignIn />;
  return <>{children}</>;
}

// StrictMode mounts effects twice; the code can only be exchanged once.
let pending: Promise<string> | null = null;
export function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    pending ??= userManager.signinRedirectCallback().then((u) => safeReturn((u.state as { returnTo?: string } | undefined)?.returnTo));
    // Cleared once used, so a later sign-in in the same visit (e.g. confirming the password) is handled too.
    pending.then((to) => { pending = null; navigate({ to, replace: true }); }).catch((e) => { pending = null; setError(e); });
  }, [navigate]);
  if (error) {
    return <FullPage><Card className="w-full max-w-md"><ErrorState title="Sign-in failed" error={error} onRetry={() => navigate({ to: "/" })} /></Card></FullPage>;
  }
  return <Loading />;
}

/** Signed in, but not part of any business, and businesses are set up by the program owner. */
function NoWorkspace() {
  const me = useMe();
  const { signOut } = useAuth();
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><MailQuestion className="size-5" /></div>
          <CardTitle className="text-lg">You're not in a workspace yet</CardTitle>
          <CardDescription>
            You're signed in as {me.data?.email}. To get in, open the invitation link you were sent, or ask your business owner to invite this address.
          </CardDescription>
        </CardHeader>
        <CardContent><Button variant="outline" onClick={() => void signOut()}>Sign out</Button></CardContent>
      </Card>
    </FullPage>
  );
}

/** "/" -> last used workspace, first workspace; with none: create the paid-for business, program admin, onboarding (self sign-up) or "ask for an invitation". */
export function HomeRedirect() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.isError) return <FullPage><Card className="w-full max-w-md"><ErrorState error={me.error} onRetry={() => me.refetch()} /></Card></FullPage>;
  const ts = me.data.tenants;
  const pick = ts.find((t) => t.slug === lastTenant() && t.tenantStatus === "active") ?? ts.find((t) => t.tenantStatus === "active") ?? ts[0];
  // Paid for a business but not created it yet: that comes first for someone with no workspace.
  if (me.data.pendingBusiness && !ts.length) return <Navigate to="/new-business" replace />;
  if (pick) return <Navigate to="/t/$slug" params={{ slug: pick.slug }} replace />;
  if (me.data.platformAdmin) return <Navigate to="/admin" replace />;
  return me.data.selfSignup ? <Navigate to="/onboarding" replace /> : <NoWorkspace />;
}

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export function Onboarding() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [region, setRegion] = useState("eu");
  const effSlug = slugEdited ? slug : slugify(name);
  const create = useMutation({
    mutationFn: () => request<TenantRef>("POST", "/tenants", { body: { name: name.trim(), slug: effSlug, region } }),
    onSuccess: async (t) => { await qc.invalidateQueries({ queryKey: ["me"] }); rememberTenant(t.slug); navigate({ to: "/t/$slug", params: { slug: t.slug } }); },
  });
  const slugBad = effSlug !== "" && !SLUG_RE.test(effSlug);
  const hasTenants = (me.data?.tenants.length ?? 0) > 0;
  if (me.isPending) return <Loading />;
  if (me.data && !me.data.selfSignup) {
    return me.data.platformAdmin ? <Navigate to="/admin" replace /> : hasTenants ? <Navigate to="/" replace /> : <NoWorkspace />;
  }
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Building2 className="size-5" /></div>
          <CardTitle className="text-lg">{hasTenants ? "Create a workspace" : "Set up your workspace"}</CardTitle>
          <CardDescription>A workspace holds your company’s data, members and apps. You’ll be its owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Field label="Company name" required>{(a) => <Input {...a} autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required placeholder="Acme Ltd" />}</Field>
            <Field label="Workspace URL" hint={`Used in links: /t/${effSlug || "acme"}`} error={slugBad ? "3–40 chars: lowercase letters, digits, dashes" : undefined} required>
              {(a) => <Input {...a} value={effSlug} onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase()); }} required />}
            </Field>
            <Field label="Data region" hint={REGION_HINT}>
              {(a) => <Select {...a} value={region} onChange={(e) => setRegion(e.target.value)}>{REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>}
            </Field>
            {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
            <div className="flex items-center justify-between gap-2 pt-1">
              {hasTenants ? <Button variant="ghost" onClick={() => history.back()}>Cancel</Button> : <span />}
              <Button type="submit" loading={create.isPending} disabled={!name.trim() || !effSlug || slugBad}>Create workspace <ArrowRight /></Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </FullPage>
  );
}

/**
 * /new-business: the owner who paid (or was invited by the program owner) creates their own business and becomes
 * its owner. Like the program owner's old "New business" dialog, without the owner's email: it's the person signed in.
 */
export function CreateBusinessPage() {
  const me = useMe();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [region, setRegion] = useState("eu");
  const effSlug = slugEdited ? slug : slugify(name);
  const slugBad = effSlug !== "" && !SLUG_RE.test(effSlug);
  const create = useMutation({
    mutationFn: () => request<{ id: string; slug: string }>("POST", "/signup/business", { body: { name: name.trim(), slug: effSlug, region } }),
    onSuccess: async (t) => { await qc.invalidateQueries({ queryKey: ["me"] }); rememberTenant(t.slug); navigate({ to: "/t/$slug", params: { slug: t.slug } }); },
  });
  if (me.isPending) return <Loading />;
  if (me.isError) return <FullPage><Card className="w-full max-w-md"><ErrorState error={me.error} onRetry={() => me.refetch()} /></Card></FullPage>;
  if (!me.data.pendingBusiness && !create.isSuccess) {
    return (
      <FullPage>
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><MailQuestion className="size-5" /></div>
            <CardTitle className="text-lg">No business waiting to be set up</CardTitle>
            <CardDescription>
              You're signed in as {me.data.email}. To create a business, subscribe on the sign-up page first, or sign in with the email address you paid with.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {me.data.tenants.length > 0 && <Button asChild><a href="/">Go to my workspace</a></Button>}
            <Button asChild variant="outline"><a href="/start">Sign-up page</a></Button>
            <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
          </CardContent>
        </Card>
      </FullPage>
    );
  }
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground"><Building2 className="size-5" /></div>
          <CardTitle className="text-lg">Create your business</CardTitle>
          <CardDescription>Your own workspace for your business. You'll be its owner: you choose its features and invite your team.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <Field label="Business name" required>{(a) => <Input {...a} autoFocus required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Ltd" />}</Field>
            <Field label="Workspace URL" hint={`Used in links: /t/${effSlug || "acme"}`} error={slugBad ? "3–40 chars: lowercase letters, digits, dashes" : undefined} required>
              {(a) => <Input {...a} required maxLength={40} value={effSlug} onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase()); }} />}
            </Field>
            <Field label="Data region" hint={REGION_HINT}>
              {(a) => <Select {...a} value={region} onChange={(e) => setRegion(e.target.value)}>{REGIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>}
            </Field>
            <p className="text-xs text-muted-foreground">Signed in as {me.data.email}. This email becomes the business owner's sign-in.</p>
            {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
            <div className="flex justify-end">
              <Button type="submit" loading={create.isPending || create.isSuccess} disabled={!name.trim() || !effSlug || slugBad}>Create business <ArrowRight /></Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </FullPage>
  );
}
