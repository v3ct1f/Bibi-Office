import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signStripePayload, type Billing, type CheckoutInput } from "../src/billing.ts";
import type { Mailer } from "../src/mail.ts";
import { setup } from "./harness.ts";

/** Paid sign-up: pay on Stripe (faked here), a signed webhook creates the business and invites its owner. */
const SECRET = "whsec_test_secret";
const checkouts: CheckoutInput[] = [];
const sent: { to: string; subject: string; text: string }[] = [];
const portals: { customerId: string; returnUrl: string }[] = [];
const billing: Billing = {
  label: "€29 per month", webhookSecret: SECRET,
  async createCheckout(i) { checkouts.push(i); return "https://checkout.stripe.test/c/abc"; },
  async portalUrl(customerId, returnUrl) { portals.push({ customerId, returnUrl }); return "https://billing.stripe.test/p/xyz"; },
};
const mailer: Mailer = { send: async (m) => { sent.push(m); } };

let h: Awaited<ReturnType<typeof setup>>;
let boss: string;
beforeAll(async () => { h = await setup([], { billing, mailer, contactEmail: "support@example.com" }); boss = await h.token("boss"); });
afterAll(async () => { await h.teardown(); });

const hook = (event: object, sig?: string) => {
  const raw = JSON.stringify(event);
  return h.app.inject({
    method: "POST", url: "/api/v1/stripe/webhook", payload: raw,
    headers: { "content-type": "application/json", "stripe-signature": sig ?? signStripePayload(raw, SECRET) },
  });
};
const completed = (sub: string, over: Record<string, unknown> = {}) => ({
  id: `evt_${sub}`, type: "checkout.session.completed",
  data: { object: {
    mode: "subscription", payment_status: "paid", subscription: sub, customer: "cus_1", customer_email: "Maria@Example.com",
    metadata: { businessName: "Maria's Bakery", slug: "marias-bakery", region: "eu" }, ...over,
  } },
});
const find = async (slug: string) => (await h.client(boss).get("/platform/businesses")).body.items.find((b: { slug: string }) => b.slug === slug);

describe("paid sign-up", () => {
  it("shows the price and starts checkout without signing in", async () => {
    expect((await h.client().get("/signup/config")).body).toEqual({ open: true, price: "€29 per month", testMode: false });
    const r = await h.client().post("/signup/checkout", { businessName: "Maria's Bakery", email: "Maria@Example.com", acceptTerms: true, businessUse: true });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("https://checkout.stripe.test/c/abc");
    expect(checkouts.at(-1)).toMatchObject({ email: "maria@example.com", slug: "marias-bakery", region: "eu", termsVersion: "2026-11-23.2" });
  });

  it("won't start checkout unless the terms are accepted", async () => {
    const n = checkouts.length;
    expect((await h.client().post("/signup/checkout", { businessName: "No Terms", email: "n@example.com" })).status).toBe(400);
    expect((await h.client().post("/signup/checkout", { businessName: "No Terms", email: "n@example.com", acceptTerms: false })).status).toBe(400);
    // Terms ticked but not business use: also refused (the Terms are for businesses only).
    expect((await h.client().post("/signup/checkout", { businessName: "No Biz", email: "n@example.com", acceptTerms: true })).status).toBe(400);
    expect((await h.client().post("/signup/checkout", { businessName: "No Biz", email: "n@example.com", acceptTerms: true, businessUse: false })).status).toBe(400);
    expect(checkouts.length).toBe(n);
  });

  it("refuses an address that is already taken, before any payment", async () => {
    await h.client(boss).post("/platform/businesses", { name: "Taken", slug: "taken-co", ownerEmail: "t@example.com" });
    const n = checkouts.length;
    const r = await h.client().post("/signup/checkout", { businessName: "Taken", slug: "taken-co", email: "x@example.com", acceptTerms: true, businessUse: true });
    expect(r.status).toBe(409);
    expect(checkouts.length).toBe(n);
  });

  it("rejects webhooks with a wrong or missing signature", async () => {
    expect((await hook(completed("sub_bad"), "t=1,v1=00")).statusCode).toBe(400);
    expect((await hook(completed("sub_bad"), signStripePayload("{}", "other-secret"))).statusCode).toBe(400);
    const raw = JSON.stringify(completed("sub_bad"));
    expect((await h.app.inject({ method: "POST", url: "/api/v1/stripe/webhook", payload: raw, headers: { "content-type": "application/json" } })).statusCode).toBe(400);
    expect(await find("marias-bakery")).toBeUndefined();
  });

  it("a paid checkout creates the business and emails the owner invitation, once", async () => {
    const before = sent.length;
    expect((await hook(completed("sub_1"))).statusCode).toBe(200);
    expect(await find("marias-bakery")).toMatchObject({
      name: "Maria's Bakery", status: "active", paid: true, ownerInvite: { email: "maria@example.com" },
    });
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.to).toBe("maria@example.com");
    // Stripe retries: no second business, no second email.
    expect((await hook(completed("sub_1"))).statusCode).toBe(200);
    expect(sent.length).toBe(before + 1);
    expect((await h.client(boss).get("/platform/businesses")).body.items.filter((b: { name: string }) => b.name === "Maria's Bakery")).toHaveLength(1);
  });

  it("gives a close variant of the address if it was taken while the customer paid", async () => {
    await hook(completed("sub_2", { customer_email: "other@example.com", metadata: { businessName: "Maria's Bakery 2", slug: "marias-bakery", region: "us" } }));
    const list = (await h.client(boss).get("/platform/businesses")).body.items;
    const second = list.find((b: { name: string }) => b.name === "Maria's Bakery 2");
    expect(second).toMatchObject({ region: "us", paid: true });
    expect(second.slug).toMatch(/^marias-bakery-[0-9a-f]{6}$/);
  });

  it("pauses when the subscription is cancelled or unpaid, and reactivates when it is paid again", async () => {
    const sub = (type: string, status: string, changed = true) => ({
      id: "evt_x", type, data: { object: { id: "sub_1", status }, ...(changed ? { previous_attributes: { status: "active" } } : {}) },
    });
    await hook(sub("customer.subscription.updated", "unpaid"));
    expect((await find("marias-bakery")).status).toBe("suspended");
    await hook(sub("customer.subscription.updated", "active"));
    expect((await find("marias-bakery")).status).toBe("active");
    await hook(sub("customer.subscription.deleted", "canceled", false));
    expect((await find("marias-bakery")).status).toBe("suspended");
    // An unrelated update (no status change) leaves a pause alone.
    await hook(sub("customer.subscription.updated", "active", false));
    expect((await find("marias-bakery")).status).toBe("suspended");
  });

  it("ignores events it doesn't know and unpaid checkouts", async () => {
    expect((await hook({ id: "e", type: "invoice.created", data: { object: {} } })).json()).toEqual({ ignored: true });
    await hook(completed("sub_3", { payment_status: "unpaid", metadata: { businessName: "Nope", slug: "nope-co", region: "eu" } }));
    expect(await find("nope-co")).toBeUndefined();
  });
});

describe("failed payments pause the business and paying brings it back", () => {
  /** A paid business whose owner has accepted the invitation. */
  async function paid(slug: string, sub: string, ownerSub: string) {
    await hook(completed(sub, { customer: `cus_${sub}`, customer_email: `${ownerSub}@example.com`, metadata: { businessName: `Biz ${slug}`, slug, region: "eu" } }));
    const biz = await find(slug);
    const link = (await h.client(boss).post(`/platform/businesses/${biz.id}/owner-invite`, { email: `${ownerSub}@example.com` })).body.invitation.link as string;
    const owner = await h.token(ownerSub, `${ownerSub}@example.com`);
    await h.client(owner).post("/invitations/accept", { tenantId: biz.id, token: link.split("/").pop() });
    return { id: biz.id as string, owner };
  }
  const failed = (sub: string, extra: Record<string, unknown> = {}) => hook({
    id: "evt_f", type: "invoice.payment_failed", data: { object: { subscription: sub, hosted_invoice_url: "https://invoice.stripe.test/i/abc", ...extra } },
  });
  const paidInvoice = (sub: string) => hook({ id: "evt_p", type: "invoice.paid", data: { object: { subscription: sub } } });
  const mailsTo = (to: string) => sent.filter((m) => m.to === to);
  const flags = async (id: string) => (await h.ownerSql`select status, billing_paused_at, subscription_ended_at from tenants where id = ${id}`)[0]!;

  it("pauses at once, emails the owner a link to pay, and lets nobody in until it is paid", async () => {
    const { id, owner } = await paid("late-payer", "sub_f1", "lena");
    expect((await h.client(owner, id).get("/contacts")).status).toBe(200);
    const before = mailsTo("lena@example.com").length;
    expect((await failed("sub_f1")).json()).toMatchObject({ paused: true });
    expect((await find("late-payer")).status).toBe("suspended");
    expect((await h.client(owner, id).get("/contacts")).status).toBe(403);
    const mail = mailsTo("lena@example.com").at(-1)!;
    expect(mailsTo("lena@example.com").length).toBe(before + 1);
    expect(mail.subject).toMatch(/Payment failed/);
    expect(mail.text).toContain("https://invoice.stripe.test/i/abc");
    expect(mail.text).toMatch(/switched back on automatically/);
    expect(mail.text).toContain("support@example.com");
    // Not the "subscription ended" clock: that only starts if Stripe gives up.
    expect(await flags(id)).toMatchObject({ status: "suspended", subscription_ended_at: null });
    expect((await flags(id)).billing_paused_at).not.toBeNull();
  });

  it("Stripe's retries don't send the same email again", async () => {
    const { id } = await paid("retried", "sub_f2", "ravi");
    await failed("sub_f2");
    const n = mailsTo("ravi@example.com").length;
    expect((await failed("sub_f2")).json()).toMatchObject({ alreadyPaused: true });
    await failed("sub_f2");
    expect(mailsTo("ravi@example.com").length).toBe(n);
    expect((await flags(id)).status).toBe("suspended");
  });

  it("paying switches it back on and emails the owner", async () => {
    const { id, owner } = await paid("pays-up", "sub_f3", "pia");
    await failed("sub_f3");
    expect((await h.client(owner, id).get("/contacts")).status).toBe(403);
    const n = mailsTo("pia@example.com").length;
    expect((await paidInvoice("sub_f3")).json()).toMatchObject({ resumed: true });
    expect((await find("pays-up")).status).toBe("active");
    expect(await flags(id)).toMatchObject({ billing_paused_at: null, subscription_ended_at: null });
    expect((await h.client(owner, id).get("/contacts")).status).toBe(200);
    expect(mailsTo("pia@example.com").length).toBe(n + 1);
    const mail = mailsTo("pia@example.com").at(-1)!;
    expect(mail.subject).toMatch(/active again/);
    expect(mail.text).toContain("/t/pays-up");
    // A second "paid" message from Stripe changes and sends nothing.
    expect((await paidInvoice("sub_f3")).json()).toEqual({ ignored: true });
    expect(mailsTo("pia@example.com").length).toBe(n + 1);
  });

  it("a business the program owner paused by hand is left alone by payments, in both directions", async () => {
    const { id } = await paid("hand-paused", "sub_f4", "hugo");
    await h.client(boss).post(`/platform/businesses/${id}/pause`, {});
    const n = sent.length;
    expect((await failed("sub_f4")).json()).toMatchObject({ alreadyPaused: true });
    expect((await paidInvoice("sub_f4")).json()).toEqual({ ignored: true });
    expect((await find("hand-paused")).status).toBe("suspended");
    expect(sent.length).toBe(n);
  });

  it("if Stripe gives up the subscription ends (the erasure countdown starts); paying later still brings it back", async () => {
    const { id } = await paid("gives-up", "sub_f5", "gina");
    await failed("sub_f5");
    await hook({ id: "e", type: "customer.subscription.updated", data: { object: { id: "sub_f5", status: "unpaid" }, previous_attributes: { status: "past_due" } } });
    const f = await flags(id);
    expect(f.status).toBe("suspended");
    expect(f.subscription_ended_at).not.toBeNull();
    expect((await paidInvoice("sub_f5")).json()).toMatchObject({ resumed: true });
    expect(await flags(id)).toMatchObject({ status: "active", billing_paused_at: null, subscription_ended_at: null });
  });

  it("reads the subscription from newer Stripe invoices, and ignores invoices of unknown subscriptions", async () => {
    const { id } = await paid("new-api", "sub_f6", "nils");
    const r = await hook({ id: "e", type: "invoice.payment_failed", data: { object: { parent: { subscription_details: { subscription: "sub_f6" } } } } });
    expect(r.json()).toMatchObject({ paused: true });
    expect((await flags(id)).status).toBe("suspended");
    expect((await failed("sub_nobody")).json()).toEqual({ ignored: true });
    expect((await paidInvoice("sub_nobody")).json()).toEqual({ ignored: true });
    expect((await hook({ id: "e", type: "invoice.payment_failed", data: { object: {} } })).json()).toEqual({ ignored: true });
  });

  it("with no owner yet, the notice goes to the billing email on the invoice", async () => {
    await hook(completed("sub_f7", { customer_email: "buyer@example.com", metadata: { businessName: "No Owner Yet", slug: "no-owner-yet", region: "eu" } }));
    const n = mailsTo("buyer@example.com").length;      // the invitation already went here
    await failed("sub_f7", { customer_email: "Buyer@Example.com" });
    expect(mailsTo("buyer@example.com").length).toBe(n + 1);
    expect(mailsTo("buyer@example.com").at(-1)!.subject).toMatch(/Payment failed/);
  });
});

describe("manage subscription", () => {
  it("lets the owner of a paid business open Stripe's billing page, nobody else", async () => {
    const biz = await find("marias-bakery");
    await hook({ id: "e0", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active" }, previous_attributes: { status: "unpaid" } } });
    const link = (await h.client(boss).post(`/platform/businesses/${biz.id}/owner-invite`, { email: "maria@example.com" })).body.invitation.link as string;
    const maria = await h.token("maria", "maria@example.com");
    expect((await h.client(maria).post("/invitations/accept", { tenantId: biz.id, token: link.split("/").pop() })).status).toBe(200);
    const r = await h.client(maria, biz.id).post("/billing/portal", {});
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("https://billing.stripe.test/p/xyz");
    expect(portals.at(-1)).toMatchObject({ customerId: "cus_1", returnUrl: expect.stringMatching(/\/t\/marias-bakery\/settings$/) });
    // Someone outside the business, and a business that didn't pay through Stripe.
    const stranger = await h.token("stranger2");
    expect((await h.client(stranger, biz.id).post("/billing/portal", {})).status).toBeGreaterThanOrEqual(403);
    const hand = (await h.client(boss).post("/platform/businesses", { name: "By Hand", slug: "by-hand", ownerEmail: "hand@example.com" })).body;
    const handOwner = await h.token("hand", "hand@example.com");
    await h.client(handOwner).post("/invitations/accept", { tenantId: hand.business.id, token: hand.invitation.link.split("/").pop() });
    expect((await h.client(handOwner, hand.business.id).post("/billing/portal", {})).status).toBe(404);
  });

  it("a customer who cancels keeps everything until the paid month ends, then it pauses", async () => {
    await hook(completed("sub_9", { customer_email: "cancel@example.com", metadata: { businessName: "Cancels Co", slug: "cancels-co", region: "eu" } }));
    // They press "cancel" in Stripe's portal: Stripe only sets a flag (no status change), so nothing happens yet.
    await hook({ id: "e1", type: "customer.subscription.updated", data: { object: { id: "sub_9", status: "active", cancel_at_period_end: true }, previous_attributes: { cancel_at_period_end: false } } });
    expect((await find("cancels-co")).status).toBe("active");
    // At the end of the paid period Stripe deletes the subscription.
    await hook({ id: "e2", type: "customer.subscription.deleted", data: { object: { id: "sub_9", status: "canceled" } } });
    expect((await find("cancels-co")).status).toBe("suspended");
  });
});

describe("sign-up closed", () => {
  it("says so when Stripe isn't set up", async () => {
    const closed = await setup([], {});
    try {
      expect((await closed.client().get("/signup/config")).body).toEqual({ open: false, price: "", testMode: false });
      expect((await closed.client().post("/signup/checkout", { businessName: "X", email: "x@example.com", acceptTerms: true, businessUse: true })).status).toBe(503);
    } finally { await closed.teardown(); }
  });
});
