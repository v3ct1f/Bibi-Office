import { useState } from "react";
import { Link, Navigate, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, FlaskConical, MailCheck, Users } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorState, Field, Input, Select } from "@office/ui";
import { request } from "../api/client.ts";
import { COMPANY } from "../legal/company.ts";
import { FullPage } from "./auth.tsx";
import { priceText, type Interval } from "./PlanCards.tsx";
import { usePublicPlans } from "./Plans.tsx";

const slugify = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/**
 * Public: a new business signs up. With test payments on (the plans on /plans), it picks a plan and "pays" with one click,
 * nothing is charged. Otherwise it pays a monthly subscription on Stripe's own page.
 */
export function StartPage() {
  const cfg = useQuery({ queryKey: ["signup-config"], queryFn: () => request<{ open: boolean; price: string; testMode: boolean }>("GET", "/signup/config", { anonymous: true }) });
  const search = useSearch({ strict: false }) as { plan?: string; interval?: string };
  const plans = usePublicPlans();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState<"eu" | "us">("eu");
  const [agreed, setAgreed] = useState(false);
  const [business, setBusiness] = useState(false);
  const interval: Interval = search.interval === "yearly" ? "yearly" : "monthly";
  const plan = plans.data?.plans.find((p) => p.key === search.plan);
  const test = !!cfg.data?.testMode;

  const go = useMutation({
    mutationFn: () => test
      ? request<{ url?: string }>("POST", "/signup/test-checkout", {
        body: { plan: plan!.key, interval, businessName: name, slug: slug || slugify(name), email, region, acceptTerms: agreed, businessUse: business }, anonymous: true,
      })
      : request<{ url?: string }>("POST", "/signup/checkout", {
        body: { businessName: name, slug: slug || slugify(name), email, region, acceptTerms: agreed, businessUse: business }, anonymous: true,
      }),
    onSuccess: (r) => {
      if (r.url) window.location.href = r.url;
      else void navigate({ to: "/start/thanks", search: { test: "1", plan: plan!.key } });
    },
  });

  // With plans on, a visit without a (valid) plan goes to the plan page first.
  if (test && plans.data && !plan) return <Navigate to="/plans" replace />;
  const closed = cfg.data && !cfg.data.open;
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Building2 className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">{plan ? `Start with ${plan.name}` : "Start your business on Office"}</CardTitle>
          <CardDescription>
            {closed ? "Sign-up isn't open yet. Please check back soon."
              : test ? "Tell us about your business. We'll email you the link to open your account."
              : `Your own workspace for your team${cfg.data?.price ? `: ${cfg.data.price}` : ""}. You pay on Stripe's secure page, then we email you the link to open your account.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {test && plan && (
            <div className="grid gap-1 rounded-md border bg-muted/50 px-3 py-2 text-sm" data-testid="chosen-plan">
              <p className="flex items-center justify-between gap-2">
                <span className="font-medium">{plan.name} plan</span>
                <Link to="/plans" className="text-xs underline">Change plan</Link>
              </p>
              <p className="text-muted-foreground">{priceText(plan, interval)} · <Users className="inline size-3.5" /> up to {plan.people} people</p>
              <p className="flex items-start gap-1.5 pt-1 text-xs"><FlaskConical className="mt-0.5 size-3.5 shrink-0 text-primary" /><span><strong>Test payment:</strong> no card needed and nothing is charged.</span></p>
            </div>
          )}
          {!closed && (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); go.mutate(); }}>
              <Field label="Business name">
                {(a) => <Input {...a} required maxLength={200} autoFocus value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field label="Web address" hint={`Letters, numbers and dashes. Suggested: ${slug || slugify(name) || "your-business"}`}>
                {(a) => <Input {...a} maxLength={40} placeholder={slugify(name)} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />}
              </Field>
              <Field label="Your email" hint="The invitation to your account is sent here.">
                {(a) => <Input {...a} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <Field label="Where is your data kept?">
                {(a) => (
                  <Select {...a} value={region} onChange={(e) => setRegion(e.target.value as "eu" | "us")}>
                    <option value="eu">Europe</option>
                    <option value="us">United States</option>
                  </Select>
                )}
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={business} onCheckedChange={(v) => setBusiness(v === true)} className="mt-0.5" aria-label="I am signing up for business or professional use" />
                <span>I am signing up for <strong>business or professional use</strong>, not as a private consumer.</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" aria-label="I agree to the Terms and the Privacy Policy" />
                <span>
                  I agree to the <Link to="/terms" target="_blank" className="underline">Terms</Link> and the <Link to="/privacy" target="_blank" className="underline">Privacy Policy</Link>.
                  {test ? " This is a test period: nothing is charged." : " The subscription renews monthly, you can cancel any time and keep access until the month ends, and payments aren't refundable."}
                </span>
              </label>
              {go.isError && <ErrorState error={go.error} />}
              <Button className="w-full" type="submit" loading={go.isPending || go.isSuccess} disabled={!agreed || !business || (test && !plan)}>
                {test ? `Start ${plan?.name ?? ""} (test payment)`.replace("  ", " ") : "Continue to payment"}
              </Button>
            </form>
          )}
          <Button asChild variant="ghost" className="w-full"><Link to="/">Already have an account? Sign in</Link></Button>
        </CardContent>
      </Card>
    </FullPage>
  );
}

/** Where people land after paying (or after the test payment). The account arrives by email within a minute or so. */
export function StartThanksPage() {
  const { test } = useSearch({ strict: false }) as { test?: string; plan?: string };
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <MailCheck className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">{test ? "You're all set" : "Thank you, payment received"}</CardTitle>
          <CardDescription>
            {test
              ? `Your business is ready and nothing was charged. Open the email we just sent you and use the link in it to create your account. Check your spam folder if it doesn't arrive. Questions? Write to ${COMPANY.email}.`
              : "We're setting up your business. In a minute or two you'll get an email with the link to open it. Check your spam folder if it doesn't arrive."}
          </CardDescription>
        </CardHeader>
        <CardContent><Button asChild variant="ghost" className="w-full"><Link to="/">Go to sign in</Link></Button></CardContent>
      </Card>
    </FullPage>
  );
}
