import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, MailCheck } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorState, Field, Input, Select } from "@office/ui";
import { request } from "../api/client.ts";
import { FullPage } from "./auth.tsx";

const slugify = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/** Public: a new business signs up and pays by monthly subscription on Stripe's own page. */
export function StartPage() {
  const cfg = useQuery({ queryKey: ["signup-config"], queryFn: () => request<{ open: boolean; price: string; workmail: string | null }>("GET", "/signup/config", { anonymous: true }) });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [region, setRegion] = useState<"eu" | "us">("eu");
  const [agreed, setAgreed] = useState(false);
  const [business, setBusiness] = useState(false);
  const [workmail, setWorkmail] = useState(false);
  const go = useMutation({
    mutationFn: () => request<{ url: string }>("POST", "/signup/checkout", {
      body: { businessName: name, slug: slug || slugify(name), email, region, acceptTerms: agreed, businessUse: business, workmail: workmail && !!cfg.data?.workmail }, anonymous: true,
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
              : `Your own workspace for your team${cfg.data?.price ? `: ${cfg.data.price}` : ""}. You pay on Stripe's secure page, then we email you the link to open your account.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              {cfg.data?.workmail && (
                <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                  <Checkbox checked={workmail} onCheckedChange={(v) => setWorkmail(v === true)} className="mt-0.5" aria-label={`Add work email and a company domain (+${cfg.data.workmail})`} />
                  <span>
                    <strong>Add work email and a company domain</strong> <span className="text-muted-foreground">(+{cfg.data.workmail})</span>
                    <span className="block text-xs text-muted-foreground">Optional. Mailboxes like anna@yourcompany.com for your team. You can also add it later.</span>
                  </span>
                </label>
              )}
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

/** Where Stripe sends people after paying. The account arrives by email within a minute or so. */
export function StartThanksPage() {
  return (
    <FullPage>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <MailCheck className="mb-2 size-10 text-primary" />
          <CardTitle className="text-lg">Thank you, payment received</CardTitle>
          <CardDescription>
            We're setting up your business. In a minute or two you'll get an email with the link to open it. Check your spam folder if it doesn't arrive.
          </CardDescription>
        </CardHeader>
        <CardContent><Button asChild variant="ghost" className="w-full"><Link to="/">Go to sign in</Link></Button></CardContent>
      </Card>
    </FullPage>
  );
}
