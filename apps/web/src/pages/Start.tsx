import { useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CreditCard, FlaskConical, MailCheck, Users } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorState, Field, Input, Spinner } from "@office/ui";
import { ApiError, request } from "../api/client.ts";
import { config } from "../config.ts";
import { COMPANY } from "../legal/company.ts";
import { FullPage } from "./auth.tsx";
import { priceText, type Interval, type PlanInfo } from "./PlanCards.tsx";
import { usePublicPlans } from "./Plans.tsx";

interface SignupConfig { open: boolean; price: string; testMode: boolean }

/** When the web app can't talk to the API at all (wrong address, API not started), say so plainly instead of showing the form. */
function ServerUnreachable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const network = error instanceof ApiError && error.status === 0;
  return (
    <ErrorState
      title={network ? "The Office server can't be reached" : "Sign-up couldn't be loaded"}
      error={network
        ? new Error(`This page talks to the Office server at ${config.apiUrl}, and it isn't answering. If you're running Office on this computer, start the API (pnpm dev:local --port 3100) or check VITE_API_URL in apps/web/.env.local.`)
        : error}
      onRetry={onRetry}
    />
  );
}

/**
 * Public: a new business owner chooses a plan (on /plans) and pays. Only their email is asked here; after paying they
 * get an email to create their account, then they create their business (name, web address, region).
 * Payment is Stripe's own page, or, on a local / try-out server without Stripe, our demo checkout page (nothing charged).
 */
export function StartPage() {
  const cfg = useQuery({ queryKey: ["signup-config"], queryFn: () => request<SignupConfig>("GET", "/signup/config", { anonymous: true }), retry: 1 });
  const search = useSearch({ strict: false }) as { plan?: string; interval?: string };
  const plans = usePublicPlans();
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [business, setBusiness] = useState(false);
  const interval: Interval = search.interval === "yearly" ? "yearly" : "monthly";
  const plan = plans.data?.plans.find((p) => p.key === search.plan);
  const demo = !!cfg.data?.testMode;

  const go = useMutation({
    mutationFn: () => request<{ url: string }>("POST", "/signup/checkout", {
      body: { email, ...(plan ? { plan: plan.key, interval } : {}), acceptTerms: agreed, businessUse: business }, anonymous: true,
    }),
    onSuccess: (r) => { window.location.href = r.url; },
  });

  if (cfg.isPending) return <FullPage><Spinner /></FullPage>;
  if (cfg.isError) return <FullPage><Card className="w-full max-w-md"><ServerUnreachable error={cfg.error} onRetry={() => void cfg.refetch()} /></Card></FullPage>;
  // With demo payments on, the plans come first: a visit without a (valid) plan goes to the plans page.
  if (demo && plans.data && !plan) return <Navigate to="/plans" replace />;
  const closed = !cfg.data.open;
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Building2 className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">{plan ? `Start with ${plan.name}` : "Start your business on Office"}</CardTitle>
          <CardDescription>
            {closed ? "Sign-up isn't open yet. Please check back soon."
              : demo ? "Your email, then the (demo) payment. Afterwards we email you a link to create your account and set up your business."
              : `Your own workspace for your team${cfg.data.price ? `: ${cfg.data.price}` : ""}. You pay on Stripe's secure page, then we email you a link to create your account and set up your business.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plan && (
            <div className="grid gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm" data-testid="chosen-plan">
              <p className="flex items-center justify-between gap-2">
                <span className="font-medium">{plan.name} plan</span>
                <Link to="/plans" className="text-xs underline">Change plan</Link>
              </p>
              <p className="text-muted-foreground">{priceText(plan, interval)} · <Users className="inline size-3.5" /> up to {plan.people} people</p>
              {demo && <p className="flex items-start gap-1.5 pt-1 text-xs"><FlaskConical className="mt-0.5 size-3.5 shrink-0 text-primary" /><span><strong>Demo payment:</strong> no card needed and nothing is charged.</span></p>}
            </div>
          )}
          {!closed && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
              <Field label="Your email" hint="After paying, we send the link to create your account here. You'll sign in with it.">
                {(a) => <Input {...a} type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={business} onCheckedChange={(v) => setBusiness(v === true)} className="mt-0.5" aria-label="I am signing up for business or professional use" />
                <span>I am signing up for <strong>business or professional use</strong>, not as a private consumer.</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" aria-label="I agree to the Terms and the Privacy Policy" />
                <span>
                  I agree to the <Link to="/terms" target="_blank" className="underline">Terms</Link> and the <Link to="/privacy" target="_blank" className="underline">Privacy Policy</Link>.
                  {demo ? " This is a demo: nothing is charged."
                    : " The subscription renews monthly, you can cancel any time and keep access until the month ends, and payments aren't refundable."}
                </span>
              </label>
              {go.isError && (go.error instanceof ApiError && go.error.status === 0
                ? <ServerUnreachable error={go.error} onRetry={() => go.mutate()} /> : <ErrorState error={go.error} />)}
              <Button className="w-full" type="submit" loading={go.isPending || go.isSuccess} disabled={!agreed || !business || (demo && !plan)}>
                Continue to payment
              </Button>
            </form>
          )}
          <Button asChild variant="ghost" className="w-full"><Link to="/">Already have an account? Sign in</Link></Button>
        </CardContent>
      </Card>
    </FullPage>
  );
}

/**
 * /start/demo-pay/<id>: the pretend checkout page used instead of Stripe on local and try-out servers. It looks like a
 * payment step but has no card fields and sends nothing anywhere: "Pay" does what a real successful payment does.
 */
export function DemoPayPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ["demo-checkout", id], retry: false,
    queryFn: () => request<{ email: string; interval: Interval; plan: PlanInfo }>("GET", `/signup/demo/${id}`, { anonymous: true }),
  });
  const pay = useMutation({
    mutationFn: () => request<{ ok: true; emailed: boolean; plan: string }>("POST", `/signup/demo/${id}/pay`, { anonymous: true }),
    onSuccess: (r) => void navigate({ to: "/start/thanks", search: { demo: "1", emailed: r.emailed ? "1" : "0" } }),
  });
  const cancel = () => void navigate({ to: "/start", search: q.data ? { plan: q.data.plan.key, interval: q.data.interval } : {} });
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CreditCard className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">Payment</CardTitle>
          <CardDescription>Demo checkout: no real money, no card. Nothing is sent to a payment company.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {q.isPending ? <div className="grid place-items-center py-6"><Spinner /></div>
            : q.isError ? <ErrorState error={q.error} />
            : (
              <dl className="grid gap-2 rounded-md border bg-muted/50 p-3 text-sm" data-testid="demo-order">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Plan</dt><dd className="font-medium">{q.data.plan.name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Price</dt><dd className="text-right">{priceText(q.data.plan, q.data.interval)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">People included</dt><dd>up to {q.data.plan.people}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Email</dt><dd className="truncate">{q.data.email}</dd></div>
              </dl>
            )}
          <p role="note" className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>This page only exists on test servers without real payments. On the live site customers pay on Stripe's secure page.</span>
          </p>
          {pay.isError && <ErrorState error={pay.error} />}
          <div className="grid gap-2">
            <Button size="lg" onClick={() => pay.mutate()} loading={pay.isPending || pay.isSuccess} disabled={!q.data}>Pay (demo, no real money)</Button>
            <Button variant="outline" onClick={cancel} disabled={pay.isPending}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </FullPage>
  );
}

/** Where people land after paying (real or demo). The "create your account" email arrives within a minute or so. */
export function StartThanksPage() {
  const { demo, emailed } = useSearch({ strict: false }) as { demo?: string; emailed?: string };
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <MailCheck className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">{demo ? "Demo payment received" : "Thank you, payment received"}</CardTitle>
          <CardDescription>
            {demo && emailed === "0"
              ? "Nothing was charged. Email isn't set up on this server, so the \"create your account\" link was written to the API's log instead. Or sign in with the email you gave and you'll be asked to create your business."
              : `${demo ? "Nothing was charged. " : ""}In a minute or two you'll get an email with a link to create your account. Then sign in and create your business: its name, web address and region. Check your spam folder if the email doesn't arrive. Questions? Write to ${COMPANY.email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent><Button asChild variant="ghost" className="w-full"><Link to="/">Go to sign in</Link></Button></CardContent>
      </Card>
    </FullPage>
  );
}
