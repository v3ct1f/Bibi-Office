import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, MailCheck } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorState, Field, Input } from "@office/ui";
import { request } from "../api/client.ts";
import { FullPage } from "./auth.tsx";

/**
 * Public: a new business owner pays a monthly subscription on Stripe's own page. Only their email is asked here;
 * after paying they get an email to create their account, then they create their business (name, address, region).
 */
export function StartPage() {
  const cfg = useQuery({ queryKey: ["signup-config"], queryFn: () => request<{ open: boolean; price: string }>("GET", "/signup/config", { anonymous: true }) });
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [business, setBusiness] = useState(false);
  const go = useMutation({
    mutationFn: () => request<{ url: string }>("POST", "/signup/checkout", {
      body: { email, acceptTerms: agreed, businessUse: business }, anonymous: true,
    }),
    onSuccess: (r) => { window.location.href = r.url; },
  });
  const closed = cfg.data && !cfg.data.open;
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <Building2 className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">Start your business on Office</CardTitle>
          <CardDescription>
            {closed ? "Sign-up isn't open yet. Please check back soon."
              : `Your own workspace for your team${cfg.data?.price ? `: ${cfg.data.price}` : ""}. You pay on Stripe's secure page, then we email you a link to create your account and set up your business.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                  The subscription renews monthly, you can cancel any time and keep access until the month ends, and payments aren't refundable.
                </span>
              </label>
              {go.isError && <ErrorState error={go.error} />}
              <Button className="w-full" type="submit" loading={go.isPending || go.isSuccess} disabled={!agreed || !business}>Continue to payment</Button>
            </form>
          )}
          <Button asChild variant="ghost" className="w-full"><Link to="/">Already have an account? Sign in</Link></Button>
        </CardContent>
      </Card>
    </FullPage>
  );
}

/** Where Stripe sends people after paying. The "create your account" email arrives within a minute or so. */
export function StartThanksPage() {
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <MailCheck className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">Thank you, payment received</CardTitle>
          <CardDescription>
            In a minute or two you'll get an email with a link to create your account. Then sign in and create your business: its name, web address and region. Check your spam folder if the email doesn't arrive.
          </CardDescription>
        </CardHeader>
        <CardContent><Button asChild variant="ghost" className="w-full"><Link to="/">Go to sign in</Link></Button></CardContent>
      </Card>
    </FullPage>
  );
}
