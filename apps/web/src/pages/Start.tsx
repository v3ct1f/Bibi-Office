import { useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AtSign, Building2, CheckCircle2, CreditCard, FlaskConical, MailCheck, Users, XCircle } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorState, Field, Input, Spinner } from "@office/ui";
import { ApiError, request } from "../api/client.ts";
import { config } from "../config.ts";
import { COMPANY } from "../legal/company.ts";
import { FullPage } from "./auth.tsx";
import { perMonth, priceText, PriceNote, type Interval, type PlanInfo } from "./PlanCards.tsx";
import { t, tx } from "../i18n/core.ts";
import { useMoney } from "../lib/currency.tsx";
import { usePublicPlans } from "./Plans.tsx";

/** Work email prices, from the API (one place: packages/core/src/plans.ts WORK_EMAIL). Null when it isn't offered at sign-up. */
export interface WorkmailPrices { domainPerYear: number; mailboxPerMonth: number; exampleMailboxes: number; maxMailboxes: number; currency: string }
interface SignupConfig { open: boolean; price: string; testMode: boolean; workmail: WorkmailPrices | null }
/** What the customer chose on "Add work email": mailboxes, and the domain they'd like (bought after the business exists). */
export interface WorkmailChoice { mailboxes: number; domain: string | null }
interface StartSearch { plan?: string; interval?: string; mailboxes?: number; domain?: string }

const useSignupConfig = () => useQuery({ queryKey: ["signup-config"], queryFn: () => request<SignupConfig>("GET", "/signup/config", { anonymous: true }), retry: 1 });

/** Reads the Work email choice from the address (?mailboxes=5&domain=yourcompany.com); null when none or not offered. */
function choiceFrom(s: StartSearch, prices: WorkmailPrices | null): WorkmailChoice | null {
  const n = Number(s.mailboxes);
  if (!prices || !Number.isInteger(n) || n < 1 || n > prices.maxMailboxes) return null;
  const d = (s.domain ?? "").trim().toLowerCase();
  return { mailboxes: n, domain: d || null };
}

/** The extra cost of a Work email choice: per month for the mailboxes, per year for the domain. */
const workmailCost = (c: WorkmailChoice, p: WorkmailPrices) => ({ perMonth: c.mailboxes * p.mailboxPerMonth, perYear: c.domain ? p.domainPerYear : 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const people = (n: number) => t("common.people", { count: n });

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

/** The Work email lines and the new monthly total, shown on /start and on the demo checkout page. */
function WorkmailLines({ choice, prices, plan, interval, exact }: { choice: WorkmailChoice; prices: WorkmailPrices; plan: PlanInfo; interval: Interval; exact?: boolean }) {
  const m = useMoney();
  const eur = exact ? m.exact : m.eur;
  const cost = workmailCost(choice, prices);
  return (
    <div className="grid gap-1 border-t pt-2" data-testid="workmail-lines">
      <p className="flex justify-between gap-3">
        <span>{t("wm.line")}: {t("wm.mailboxes", { count: choice.mailboxes })} × {eur(prices.mailboxPerMonth)}</span>
        <span className="text-right">{t("wm.perMonth", { price: eur(cost.perMonth) })}</span>
      </p>
      {choice.domain && (
        <p className="flex justify-between gap-3">
          <span className="truncate">{t("wm.domainLine", { domain: choice.domain })}</span>
          <span className="shrink-0 text-right">{t("wm.perYear", { price: eur(prices.domainPerYear) })}</span>
        </p>
      )}
      <p className="flex justify-between gap-3 border-t pt-1 font-medium" data-testid="new-total">
        <span>{t("wm.newTotal")}</span>
        <span className="text-right">{t("wm.perMonth", { price: eur(round2(perMonth(plan, interval) + cost.perMonth)) })}{cost.perYear ? ` + ${t("wm.perYear", { price: eur(cost.perYear) })}` : ""}</span>
      </p>
      {choice.domain && <p className="text-xs text-muted-foreground">The domain is bought for your business right after you've set it up, in your business's name.</p>}
    </div>
  );
}

/**
 * /start/email: the optional "Add work email" step between choosing a plan and /start. Shows the prices clearly
 * (with a worked example) and lets the customer pick how many mailboxes and check that the domain they'd like is free.
 * "Skip, no thanks" goes straight on; Work email can be added later from Add features.
 */
export function WorkEmailStepPage() {
  const { eur } = useMoney();
  const cfg = useSignupConfig();
  const plans = usePublicPlans();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as StartSearch;
  const interval: Interval = search.interval === "yearly" ? "yearly" : "monthly";
  const plan = plans.data?.plans.find((p) => p.key === search.plan);
  const prices = cfg.data?.workmail ?? null;
  const prev = choiceFrom(search, prices);
  const [count, setCount] = useState(String(prev?.mailboxes ?? prices?.exampleMailboxes ?? 5));
  const [domain, setDomain] = useState(prev?.domain ?? "");
  const [checked, setChecked] = useState<{ domain: string; available: boolean; pricePerYear: number | null; others: string[] } | null>(null);
  const check = useMutation({
    mutationFn: (q: string) => request<{ offers: { domain: string; available: boolean; pricePerYear: number | null }[] }>("GET", `/signup/domain-check?q=${encodeURIComponent(q)}`, { anonymous: true }),
    onSuccess: (r, q) => {
      const want = q.includes(".") ? q : `${q}.com`;
      const mine = r.offers.find((o) => o.domain === want) ?? r.offers[0];
      setChecked(mine
        ? { domain: mine.domain, available: mine.available, pricePerYear: mine.pricePerYear, others: r.offers.filter((o) => o.available && o.domain !== mine.domain).map((o) => o.domain).slice(0, 3) }
        : { domain: want, available: false, pricePerYear: null, others: [] });
      if (mine) setDomain(mine.domain);
    },
  });

  if (cfg.isPending || plans.isPending) return <FullPage><Spinner /></FullPage>;
  if (cfg.isError) return <FullPage><Card className="w-full max-w-md"><ServerUnreachable error={cfg.error} onRetry={() => void cfg.refetch()} /></Card></FullPage>;
  if (plans.data && !plan) return <Navigate to="/plans" replace />;
  const base = { plan: search.plan, interval };
  // Not offered on this server (e.g. real Stripe payments for now): straight on to the sign-up.
  if (!prices || !plan) return <Navigate to="/start" search={base} replace />;

  const n = Number(count);
  const countOk = Number.isInteger(n) && n >= 1 && n <= prices.maxMailboxes;
  const d = domain.trim().toLowerCase();
  // A domain carried back from /start ("Change work email") was already checked.
  const domainOk = !d || d === prev?.domain || (checked?.domain === d && checked.available);
  const ex = prices.exampleMailboxes;
  const exMonth = ex * prices.mailboxPerMonth;
  const add = () => void navigate({ to: "/start", search: { ...base, mailboxes: n, ...(d ? { domain: d } : {}) } });

  return (
    <FullPage>
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <AtSign className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">{t("wm.title")}</CardTitle>
          <CardDescription>{t("wm.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-1.5 rounded-md border bg-muted/50 px-3 py-2 text-sm" data-testid="workmail-prices">
            <p className="flex justify-between gap-3"><span>{t("wm.domain")}</span><strong>{t("wm.perYear", { price: eur(prices.domainPerYear) })}</strong></p>
            <p className="flex justify-between gap-3"><span>{t("wm.mailbox")}</span><strong>{t("wm.perMonth", { price: eur(prices.mailboxPerMonth) })}</strong></p>
            <p className="border-t pt-1.5 text-muted-foreground" data-testid="workmail-example">
              Example: your domain + {ex} people = {eur(exMonth)} per month + {eur(prices.domainPerYear)} per year
              ({eur(exMonth * 12 + prices.domainPerYear)} in the first year).
            </p>
            <p className="text-muted-foreground">
              With your {plan.name} plan ({eur(perMonth(plan, interval))} per month) that is {eur(round2(perMonth(plan, interval) + exMonth))} per month, plus {eur(prices.domainPerYear)} per year for the domain.
            </p>
          </div>

          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (countOk && domainOk) add(); }}>
            <Field label={t("wm.howMany")} hint={`${t("wm.howManyHint")} ${countOk ? `${people(n)}: ${t("wm.perMonth", { price: eur(n * prices.mailboxPerMonth) })}.` : t("wm.range", { max: prices.maxMailboxes })}`}>
              {(a) => <Input {...a} type="number" min={1} max={prices.maxMailboxes} value={count} onChange={(e) => setCount(e.target.value)} className="w-28" />}
            </Field>
            <Field label={t("wm.domainLabel")} hint={t("wm.domainHint")}>
              {(a) => (
                <div className="flex gap-2">
                  <Input {...a} value={domain} placeholder="yourcompany.com" maxLength={100} autoComplete="off"
                    onChange={(e) => { setDomain(e.target.value); setChecked(null); }} />
                  <Button type="button" variant="outline" disabled={d.length < 2} loading={check.isPending} onClick={() => check.mutate(d)}>{t("wm.check")}</Button>
                </div>
              )}
            </Field>
            {check.isError && <ErrorState error={check.error} />}
            {checked && (checked.available ? (
              <p className="flex items-start gap-2 text-sm text-emerald-700 dark:text-emerald-400" role="status" data-testid="domain-result">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <span><strong>{checked.domain}</strong> is available{checked.pricePerYear !== null && checked.pricePerYear !== prices.domainPerYear ? ` (this ending costs ${eur(checked.pricePerYear)} per year)` : ""}.</span>
              </p>
            ) : (
              <p className="flex items-start gap-2 text-sm text-destructive" role="status" data-testid="domain-result">
                <XCircle className="mt-0.5 size-4 shrink-0" />
                <span><strong>{checked.domain}</strong> is taken.{checked.others.length ? ` Free: ${checked.others.join(", ")}.` : " Try another name."}</span>
              </p>
            ))}
            {d && !domainOk && !checked && <p className="text-xs text-muted-foreground">Press Check to see if it's free.</p>}
            <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              {t("wm.nothingBought")}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" variant="outline" size="lg" onClick={() => void navigate({ to: "/start", search: base })}>{t("wm.skip")}</Button>
              <Button type="submit" size="lg" disabled={!countOk || !domainOk}>{t("wm.add")}</Button>
            </div>
          </form>
          <Button asChild variant="ghost" className="w-full"><Link to="/plans">{t("wm.backToPlans")}</Link></Button>
        </CardContent>
      </Card>
    </FullPage>
  );
}

/**
 * Public: a new business owner chooses a plan (on /plans), optionally adds Work email, and pays. Only their email is
 * asked here; after paying they get an email to create their account, then they create their business.
 * Payment is Stripe's own page, or, on a local / try-out server without Stripe, our demo checkout page (nothing charged).
 */
export function StartPage() {
  const { eur } = useMoney();
  const cfg = useSignupConfig();
  const search = useSearch({ strict: false }) as StartSearch;
  const plans = usePublicPlans();
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [business, setBusiness] = useState(false);
  const interval: Interval = search.interval === "yearly" ? "yearly" : "monthly";
  const plan = plans.data?.plans.find((p) => p.key === search.plan);
  const demo = !!cfg.data?.testMode;
  const prices = cfg.data?.workmail ?? null;
  const workmail = choiceFrom(search, prices);

  const go = useMutation({
    mutationFn: () => request<{ url: string }>("POST", "/signup/checkout", {
      body: {
        email, ...(plan ? { plan: plan.key, interval } : {}), acceptTerms: agreed, businessUse: business,
        ...(workmail ? { workmail: { mailboxes: workmail.mailboxes, ...(workmail.domain ? { domain: workmail.domain } : {}) } } : {}),
      },
      anonymous: true,
    }),
    onSuccess: (r) => { window.location.href = r.url; },
  });

  if (cfg.isPending) return <FullPage><Spinner /></FullPage>;
  if (cfg.isError) return <FullPage><Card className="w-full max-w-md"><ServerUnreachable error={cfg.error} onRetry={() => void cfg.refetch()} /></Card></FullPage>;
  // With demo payments on, the plans come first: a visit without a (valid) plan goes to the plans page.
  if (demo && plans.data && !plan) return <Navigate to="/plans" replace />;
  const closed = !cfg.data.open;
  const base = { plan: search.plan, interval };
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Building2 className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">{plan ? t("start.titlePlan", { plan: plan.name }) : t("start.title")}</CardTitle>
          <CardDescription>
            {closed ? t("start.descClosed") : demo ? t("start.descDemo") : t("start.descLive")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plan && (
            <div className="grid gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm" data-testid="chosen-plan">
              <p className="flex items-center justify-between gap-2">
                <span className="font-medium">{t("start.planName", { plan: plan.name })}</span>
                <Link to="/plans" className="text-xs underline">{t("start.changePlan")}</Link>
              </p>
              <p className="text-muted-foreground">{priceText(plan, interval, eur)} · <Users className="inline size-3.5" /> {t("start.upTo", { count: plan.people })}</p>
              {workmail && prices && (
                <>
                  <WorkmailLines choice={workmail} prices={prices} plan={plan} interval={interval} />
                  <p className="flex gap-3 text-xs">
                    <Link to="/start/email" search={search} className="underline">{t("start.changeWorkmail")}</Link>
                    <Link to="/start" search={base} className="underline" aria-label="Remove work email">{t("start.remove")}</Link>
                  </p>
                </>
              )}
              {!workmail && prices && (
                <p className="text-xs"><Link to="/start/email" search={base} className="underline">{t("start.addWorkmail")}</Link> <span className="text-muted-foreground">{t("start.addWorkmailHint", { price: eur(prices.mailboxPerMonth) })}</span></p>
              )}
              {demo && <p className="flex items-start gap-1.5 pt-1 text-xs"><FlaskConical className="mt-0.5 size-3.5 shrink-0 text-primary" /><span>{t("start.demoNote")}</span></p>}
              <PriceNote className="pt-1" />
            </div>
          )}
          {!closed && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
              <Field label={t("start.email")} hint={t("start.emailHint")}>
                {(a) => <Input {...a} type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={business} onCheckedChange={(v) => setBusiness(v === true)} className="mt-0.5" aria-label={t("start.businessStrong")} />
                <span>{tx("start.business", { strong: <strong>{t("start.businessStrong")}</strong> })}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" aria-label={t("start.agree", { terms: t("legal.terms"), privacy: t("legal.privacy") })} />
                <span>
                  {tx("start.agree", { terms: <Link to="/terms" target="_blank" className="underline">{t("legal.terms")}</Link>, privacy: <Link to="/privacy" target="_blank" className="underline">{t("legal.privacy")}</Link> })}
                  {" "}{demo ? t("start.agreeDemo") : t("start.agreeLive")}
                </span>
              </label>
              {go.isError && (go.error instanceof ApiError && go.error.status === 0
                ? <ServerUnreachable error={go.error} onRetry={() => go.mutate()} /> : <ErrorState error={go.error} />)}
              <Button className="w-full" type="submit" loading={go.isPending || go.isSuccess} disabled={!agreed || !business || (demo && !plan)}>
                {t("start.continue")}
              </Button>
            </form>
          )}
          <Button asChild variant="ghost" className="w-full"><Link to="/">{t("start.haveAccount")}</Link></Button>
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
    queryFn: () => request<{ email: string; interval: Interval; plan: PlanInfo; workmail: WorkmailChoice | null; prices: WorkmailPrices }>("GET", `/signup/demo/${id}`, { anonymous: true }),
  });
  const pay = useMutation({
    mutationFn: () => request<{ ok: true; emailed: boolean; plan: string }>("POST", `/signup/demo/${id}/pay`, { anonymous: true }),
    onSuccess: (r) => void navigate({ to: "/start/thanks", search: { demo: "1", emailed: r.emailed ? "1" : "0" } }),
  });
  const cancel = () => void navigate({
    to: "/start",
    search: q.data ? {
      plan: q.data.plan.key, interval: q.data.interval,
      ...(q.data.workmail ? { mailboxes: q.data.workmail.mailboxes, ...(q.data.workmail.domain ? { domain: q.data.workmail.domain } : {}) } : {}),
    } : {},
  });
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
              <div className="grid gap-2 rounded-md border bg-muted/50 p-3 text-sm" data-testid="demo-order">
                <dl className="grid gap-2">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Plan</dt><dd className="font-medium">{q.data.plan.name}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Price</dt><dd className="text-right">{priceText(q.data.plan, q.data.interval, (n) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n))}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">People included</dt><dd>up to {q.data.plan.people}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Email</dt><dd className="truncate">{q.data.email}</dd></div>
                </dl>
                {q.data.workmail && <WorkmailLines choice={q.data.workmail} prices={{ ...q.data.prices, currency: "EUR" }} plan={q.data.plan} interval={q.data.interval} exact />}
              </div>
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
