import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paid sign-up through Stripe Checkout (a monthly subscription). Plain HTTPS calls, no Stripe package.
 * The secret key and webhook secret come from the environment and never leave the server.
 */
export interface CheckoutInput {
  email: string; businessName: string; slug: string; region: "eu" | "us"; successUrl: string; cancelUrl: string;
  /** Version of the terms the customer ticked, kept on the subscription as evidence. */
  termsVersion: string;
}

export interface Billing {
  /** What the sign-up page shows as the price, e.g. "€29 per month". */
  label: string;
  webhookSecret: string;
  /** Starts a Stripe Checkout page for a new subscription; returns the address to send the customer to. */
  createCheckout(input: CheckoutInput): Promise<string>;
  /** Stripe's own page where a customer changes their card, sees invoices and cancels (it stays active until the paid month ends). */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
}

export function stripeBilling(o: { secretKey?: string | undefined; webhookSecret?: string | undefined; priceId?: string | undefined; label?: string | undefined }): Billing | null {
  if (!o.secretKey || !o.webhookSecret || !o.priceId) return null;
  const { secretKey, webhookSecret, priceId } = o;
  const post = async (path: string, form: URLSearchParams) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: "POST", body: form, signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    });
    const json = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
    return json.url;
  };
  return {
    label: o.label || "",
    webhookSecret,
    async createCheckout(i) {
      const meta = { businessName: i.businessName, slug: i.slug, region: i.region, termsVersion: i.termsVersion, termsAcceptedAt: new Date().toISOString() };
      const form = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
        customer_email: i.email, success_url: i.successUrl, cancel_url: i.cancelUrl,
      });
      for (const [k, v] of Object.entries(meta)) { form.set(`metadata[${k}]`, v); form.set(`subscription_data[metadata][${k}]`, v); }
      return post("checkout/sessions", form);
    },
    portalUrl: (customerId, returnUrl) => post("billing_portal/sessions", new URLSearchParams({ customer: customerId, return_url: returnUrl })),
  };
}

/** Checks Stripe's `Stripe-Signature` header against the exact bytes received (5 minutes of tolerance). */
export function verifyStripeSignature(raw: Buffer, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !sigs.length || !/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > 300) return false;
  const want = createHmac("sha256", secret).update(`${t}.`).update(raw).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
}

/** For tests: a header Stripe would accept. */
export function signStripePayload(raw: string, secret: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
}
