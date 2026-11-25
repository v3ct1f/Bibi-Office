import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paid sign-up through Stripe Checkout (a monthly subscription). Plain HTTPS calls, no Stripe package.
 * The secret key and webhook secret come from the environment and never leave the server.
 */
export interface CheckoutInput {
  /** Only the payer's email: they create their business themselves after paying and making their account. */
  email: string; successUrl: string; cancelUrl: string;
  /** Version of the terms the customer ticked, kept on the subscription as evidence. */
  termsVersion: string;
  /**
   * Adds the Work email price (STRIPE_WORKMAIL_PRICE_ID) to the same subscription. Not used by the sign-up yet: the
   * sign-up offers Work email only with demo payments until Stripe has per-mailbox and per-domain prices (docs/stripe-setup.md).
   */
  workmail?: boolean;
}

export interface Billing {
  /** What the sign-up page shows as the price, e.g. "€29 per month". */
  label: string;
  webhookSecret: string;
  /** Starts a Stripe Checkout page for a new subscription; returns the address to send the customer to. */
  createCheckout(input: CheckoutInput): Promise<string>;
  /** Stripe's own page where a customer changes their card, sees invoices and cancels (it stays active until the paid month ends). */
  portalUrl(customerId: string, returnUrl: string): Promise<string>;
  /** The Work email add-on as shown to customers, e.g. "EUR 9 per month"; null when the add-on isn't for sale on this server. */
  workmailLabel: string | null;
  /** Adds the add-on to an existing subscription (the card on file is charged, pro rata). Safe to repeat. */
  addAddOn(subscriptionId: string, key: "workmail"): Promise<void>;
  /** Takes the add-on off the subscription. Safe to repeat. */
  removeAddOn(subscriptionId: string, key: "workmail"): Promise<void>;
  /** A one-off payment page (e.g. for a domain); returns the page address and an id to check later. */
  createPayment(input: PaymentInput): Promise<{ url: string; id: string }>;
  paymentPaid(id: string): Promise<boolean>;
}

export interface PaymentInput {
  customerId: string | null; amountCents: number; currency: string; description: string;
  successUrl: string; cancelUrl: string; metadata: Record<string, string>;
}

export function stripeBilling(o: { secretKey?: string | undefined; webhookSecret?: string | undefined; priceId?: string | undefined; label?: string | undefined; workmailPriceId?: string | undefined; workmailLabel?: string | undefined }): Billing | null {
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
  const call = async <T>(method: "GET" | "POST" | "DELETE", path: string, form?: URLSearchParams): Promise<T> => {
    const res = await fetch(`https://api.stripe.com/v1/${path}${method === "GET" && form ? `?${form}` : ""}`, {
      method, body: method === "POST" ? form : undefined, signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${secretKey}`, ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
    return json;
  };
  const addOnItem = async (subscriptionId: string) => {
    const list = await call<{ data: { id: string; price?: { id?: string } }[] }>("GET", "subscription_items", new URLSearchParams({ subscription: subscriptionId, limit: "100" }));
    return list.data.find((i) => i.price?.id === o.workmailPriceId) ?? null;
  };
  return {
    label: o.label || "",
    webhookSecret,
    workmailLabel: o.workmailPriceId ? o.workmailLabel || "extra per month" : null,
    async addAddOn(subscriptionId) {
      if (!o.workmailPriceId) throw new Error("Stripe: the Work email price isn't set up");
      if (await addOnItem(subscriptionId)) return;   // already there (a repeat)
      await call("POST", "subscription_items", new URLSearchParams({
        subscription: subscriptionId, price: o.workmailPriceId, quantity: "1", proration_behavior: "create_prorations", payment_behavior: "error_if_incomplete",
      }));
    },
    async removeAddOn(subscriptionId) {
      const item = await addOnItem(subscriptionId);
      if (item) await call("DELETE", `subscription_items/${item.id}?proration_behavior=create_prorations`);
    },
    async createPayment(i) {
      const form = new URLSearchParams({
        mode: "payment", success_url: i.successUrl, cancel_url: i.cancelUrl,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": i.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(i.amountCents), "line_items[0][price_data][product_data][name]": i.description,
      });
      if (i.customerId) form.set("customer", i.customerId);
      for (const [k, v] of Object.entries(i.metadata)) form.set(`metadata[${k}]`, v);
      const s = await call<{ id?: string; url?: string }>("POST", "checkout/sessions", form);
      if (!s.id || !s.url) throw new Error("Stripe: no payment page");
      return { url: s.url, id: s.id };
    },
    async paymentPaid(id) {
      const s = await call<{ payment_status?: string }>("GET", `checkout/sessions/${encodeURIComponent(id)}`);
      return s.payment_status === "paid";
    },
    async createCheckout(i) {
      const meta: Record<string, string> = { termsVersion: i.termsVersion, termsAcceptedAt: new Date().toISOString() };
      const workmail = !!i.workmail && !!o.workmailPriceId;
      if (workmail) meta.workmail = "1";
      const form = new URLSearchParams({
        mode: "subscription",
        "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
        customer_email: i.email, success_url: i.successUrl, cancel_url: i.cancelUrl,
      });
      if (workmail) { form.set("line_items[1][price]", o.workmailPriceId!); form.set("line_items[1][quantity]", "1"); }
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
