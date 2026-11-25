import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signStripePayload, type Billing, type CheckoutInput } from "../src/billing.ts";
import type { Mailer } from "../src/mail.ts";
import { setup } from "./harness.ts";

/**
 * Paid sign-up: pay on Stripe (faked here); a signed webhook emails the payer a "create your account" link; signed in
 * with that email they create their business and are its owner.
 */
const SECRET = "whsec_test_secret";
const checkouts: CheckoutInput[] = [];
const sent: { to: string; subject: string; text: string }[] = [];
const portals: { customerId: string; returnUrl: string }[] = [];
const billing: Billing = {
  label: "€29 per month", webhookSecret: SECRET,
  async createCheckout(i) { checkouts.push(i); return "https://checkout.stripe.test/c/abc"; },
  async portalUrl(customerId, returnUrl) { portals.push({ customerId, returnUrl }); return "https://billing.stripe.test/p/xyz"; },
  workmailLabel: null, async addAddOn() {}, async removeAddOn() {}, async createPayment() { return { url: "", id: "" }; }, async paymentPaid() { return false; },
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
    metadata: { termsVersion: "2026-11-24.1" }, ...over,
  } },
});
const find = async (slug: string) => (await h.client(boss).get("/platform/businesses")).body.items.find((b: { slug: string }) => b.slug === slug);
const waiting = async () => (await h.client(boss).get("/platform/owner-signups")).body.items as { id: string; email: string; source: string; ended: boolean }[];

describe("paid sign-up", () => {
  it("shows the price and starts checkout with only an email, without signing in", async () => {
    expect((await h.client().get("/signup/config")).body).toEqual({ open: true, price: "€29 per month", testMode: false, workmail: null });
    const r = await h.client().post("/signup/checkout", { email: "Maria@Example.com", acceptTerms: true, businessUse: true });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("https://checkout.stripe.test/c/abc");
    expect(checkouts.at(-1)).toEqual({
      email: "maria@example.com", termsVersion: "2026-11-24.1",
      successUrl: expect.stringMatching(/\/start\/thanks$/), cancelUrl: expect.stringMatching(/\/start$/),
    });
    // The business details are no longer asked before paying.
    expect((await h.client().post("/signup/checkout", { businessName: "X", email: "x@example.com", acceptTerms: true, businessUse: true })).status).toBe(400);
  });

  it("won't start checkout unless the terms are accepted", async () => {
    const n = checkouts.length;
    expect((await h.client().post("/signup/checkout", { email: "n@example.com" })).status).toBe(400);
    expect((await h.client().post("/signup/checkout", { email: "n@example.com", acceptTerms: false })).status).toBe(400);
    // Terms ticked but not business use: also refused (the Terms are for businesses only).
    expect((await h.client().post("/signup/checkout", { email: "n@example.com", acceptTerms: true })).status).toBe(400);
    expect((await h.client().post("/signup/checkout", { email: "n@example.com", acceptTerms: true, businessUse: false })).status).toBe(400);
    expect(checkouts.length).toBe(n);
  });

  it("rejects webhooks with a wrong or missing signature", async () => {
    expect((await hook(completed("sub_bad"), "t=1,v1=00")).statusCode).toBe(400);
    expect((await hook(completed("sub_bad"), signStripePayload("{}", "other-secret"))).statusCode).toBe(400);
    const raw = JSON.stringify(completed("sub_bad"));
    expect((await h.app.inject({ method: "POST", url: "/api/v1/stripe/webhook", payload: raw, headers: { "content-type": "application/json" } })).statusCode).toBe(400);
    expect((await waiting()).find((w) => w.email === "maria@example.com")).toBeUndefined();
  });

  it("a paid checkout emails the payer a link to create their account, once; no business exists yet", async () => {
    const before = sent.length;
    expect((await hook(completed("sub_1"))).statusCode).toBe(200);
    expect(sent.length).toBe(before + 1);
    const mail = sent.at(-1)!;
    expect(mail.to).toBe("maria@example.com");
    expect(mail.subject).toMatch(/create your account/);
    expect(mail.text).toContain("/new-business");
    expect(await waiting()).toEqual([expect.objectContaining({ email: "maria@example.com", source: "stripe", ended: false })]);
    expect((await h.client(boss).get("/platform/businesses")).body.items).toHaveLength(0);
    // Stripe retries: no second sign-up, no second email.
    expect((await hook(completed("sub_1"))).json()).toMatchObject({ repeat: true });
    expect(sent.length).toBe(before + 1);
    expect(await waiting()).toHaveLength(1);
  });

  it("only the payer's verified email can create the business", async () => {
    const other = await h.token("otto", "otto@example.com");
    expect((await h.client(other).get("/me")).body.pendingBusiness).toBe(false);
    expect((await h.client(other).post("/signup/business", { name: "Not Mine", slug: "not-mine", region: "eu" })).status).toBe(403);
    // Right address but not verified by the sign-in service.
    const unverified = await h.token("maria", "maria@example.com", { email_verified: undefined });
    expect((await h.client(unverified).post("/signup/business", { name: "Sneaky", slug: "sneaky", region: "eu" })).status).toBe(403);
    expect(await find("not-mine")).toBeUndefined();
    expect(await find("sneaky")).toBeUndefined();
  });

  it("checks the address and region, and keeps the sign-up when one is wrong", async () => {
    await h.client(boss).post("/platform/businesses", { name: "Taken", slug: "taken-co", ownerEmail: "t@example.com" });
    const maria = await h.token("maria", "maria@example.com");
    const taken = await h.client(maria).post("/signup/business", { name: "Maria's Bakery", slug: "taken-co", region: "eu" });
    expect(taken.status).toBe(409);
    expect(JSON.stringify(taken.body)).toMatch(/already taken/);
    expect((await h.client(maria).post("/signup/business", { name: "Maria's Bakery", slug: "marias-bakery", region: "mars" })).status).toBe(400);
    expect((await h.client(maria).post("/signup/business", { name: "Maria's Bakery", slug: "No Spaces!", region: "eu" })).status).toBe(400);
    expect((await h.client(maria).get("/me")).body.pendingBusiness).toBe(true);
  });

  it("the payer creates their business (name, address, region) and is its owner at once", async () => {
    const maria = await h.token("maria", "maria@example.com");
    expect((await h.client(maria).get("/me")).body).toMatchObject({ pendingBusiness: true, tenants: [] });
    const r = await h.client(maria).post("/signup/business", { name: "Maria's Bakery", slug: "marias-bakery", region: "asia" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ slug: "marias-bakery", name: "Maria's Bakery", region: "asia" });
    expect(await find("marias-bakery")).toMatchObject({
      name: "Maria's Bakery", region: "asia", status: "active", paid: true, owners: [{ email: "maria@example.com" }], ownerInvite: null,
    });
    const me = (await h.client(maria).get("/me")).body;
    expect(me.pendingBusiness).toBe(false);
    expect(me.tenants).toEqual([expect.objectContaining({ slug: "marias-bakery" })]);
    expect((await h.client(maria, r.body.id).get("/contacts")).status).toBe(200);
    expect((await h.client(maria, r.body.id).get("/members")).body).toEqual([expect.objectContaining({ email: "maria@example.com", roles: expect.arrayContaining(["owner"]) })]);
    // One payment, one business.
    expect((await h.client(maria).post("/signup/business", { name: "Second", slug: "maria-second", region: "eu" })).status).toBe(403);
    expect(await waiting()).toHaveLength(0);
  });

  it("every region in the list is accepted", async () => {
    for (const [i, region] of ["eu", "us", "sa", "asia", "middle-east", "africa", "oceania"].entries()) {
      await hook(completed(`sub_r${i}`, { customer_email: `region${i}@example.com` }));
      const t = await h.token(`region${i}`, `region${i}@example.com`);
      const r = await h.client(t).post("/signup/business", { name: `Region ${i}`, slug: `region-${i}`, region });
      expect(r.status, region).toBe(201);
      expect(r.body.region).toBe(region);
    }
  });

  it("a subscription that ends before the business is created can't be used; paying again reopens it", async () => {
    await hook(completed("sub_e", { customer_email: "late@example.com" }));
    const late = await h.token("late", "late@example.com");
    const sub = (status: string) => hook({ id: "e", type: "customer.subscription.updated", data: { object: { id: "sub_e", status }, previous_attributes: { status: "x" } } });
    expect((await sub("unpaid")).json()).toMatchObject({ signupEnded: true });
    expect((await waiting()).find((w) => w.email === "late@example.com")).toMatchObject({ ended: true });
    expect((await h.client(late).get("/me")).body.pendingBusiness).toBe(false);
    expect((await h.client(late).post("/signup/business", { name: "Late", slug: "late-co", region: "eu" })).status).toBe(403);
    expect((await sub("active")).json()).toMatchObject({ signupEnded: false });
    expect((await h.client(late).post("/signup/business", { name: "Late", slug: "late-co", region: "eu" })).status).toBe(201);
    // A failed payment before there's a business changes nothing.
    await hook(completed("sub_e2", { customer_email: "early@example.com" }));
    expect((await hook({ id: "f", type: "invoice.payment_failed", data: { object: { subscription: "sub_e2" } } })).json()).toEqual({ ignored: true });
  });

  it("ignores events it doesn't know and unpaid checkouts", async () => {
    expect((await hook({ id: "e", type: "invoice.created", data: { object: {} } })).json()).toEqual({ ignored: true });
    expect((await hook(completed("sub_3", { payment_status: "unpaid", customer_email: "nope@example.com" }))).json()).toEqual({ ignored: true });
    expect((await waiting()).find((w) => w.email === "nope@example.com")).toBeUndefined();
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
});

describe("failed payments pause the business and paying brings it back", () => {
  /** A paid business whose owner created it after paying. */
  async function paid(slug: string, sub: string, ownerSub: string) {
    await hook(completed(sub, { customer: `cus_${sub}`, customer_email: `${ownerSub}@example.com` }));
    const owner = await h.token(ownerSub, `${ownerSub}@example.com`);
    const r = await h.client(owner).post("/signup/business", { name: `Biz ${slug}`, slug, region: "eu" });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return { id: r.body.id as string, owner };
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
});

describe("manage subscription", () => {
  it("lets the owner of a paid business open Stripe's billing page, nobody else", async () => {
    const biz = await find("marias-bakery");
    await hook({ id: "e0", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active" }, previous_attributes: { status: "unpaid" } } });
    const maria = await h.token("maria", "maria@example.com");
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
    await hook(completed("sub_9", { customer_email: "cancel@example.com" }));
    const c = await h.token("canceller", "cancel@example.com");
    expect((await h.client(c).post("/signup/business", { name: "Cancels Co", slug: "cancels-co", region: "eu" })).status).toBe(201);
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
      expect((await closed.client().get("/signup/config")).body).toEqual({ open: false, price: "", testMode: false, workmail: null });
      expect((await closed.client().post("/signup/checkout", { email: "x@example.com", acceptTerms: true, businessUse: true })).status).toBe(503);
    } finally { await closed.teardown(); }
  });
});

describe("the program owner invites a business owner by hand", () => {
  it("only the program owner can, and the person gets the create-your-account email", async () => {
    const nobody = await h.token("nobody");
    expect((await h.client(nobody).post("/platform/owner-signups", { email: "ivy@example.com" })).status).toBe(403);
    expect((await h.client(nobody).get("/platform/owner-signups")).status).toBe(403);
    const n = sent.length;
    const r = await h.client(boss).post("/platform/owner-signups", { email: "Ivy@Example.com" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ email: "ivy@example.com", emailed: true, link: expect.stringMatching(/\/new-business$/) });
    expect(sent.length).toBe(n + 1);
    expect(sent.at(-1)).toMatchObject({ to: "ivy@example.com", subject: expect.stringMatching(/invited to set up your business/) });
    // Inviting the same address again doesn't make a second one.
    await h.client(boss).post("/platform/owner-signups", { email: "ivy@example.com" });
    expect((await waiting()).filter((w) => w.email === "ivy@example.com")).toEqual([expect.objectContaining({ source: "program_owner" })]);
  });

  it("resends the email; the invited owner creates an unpaid business", async () => {
    const id = (await waiting()).find((w) => w.email === "ivy@example.com")!.id;
    const n = sent.length;
    expect((await h.client(boss).post(`/platform/owner-signups/${id}/resend`, {})).status).toBe(200);
    expect(sent.length).toBe(n + 1);
    const ivy = await h.token("ivy", "ivy@example.com");
    const r = await h.client(ivy).post("/signup/business", { name: "Ivy Florist", slug: "ivy-florist", region: "oceania" });
    expect(r.status).toBe(201);
    expect(await find("ivy-florist")).toMatchObject({ paid: false, region: "oceania", owners: [{ email: "ivy@example.com" }] });
    expect((await h.client(boss).post(`/platform/owner-signups/${id}/resend`, {})).status).toBe(404);
  });

  it("can withdraw an unused invitation, but not a paid sign-up", async () => {
    const r = await h.client(boss).post("/platform/owner-signups", { email: "wes@example.com" });
    expect((await h.client(boss).del(`/platform/owner-signups/${r.body.id}`)).status).toBe(204);
    const wes = await h.token("wes", "wes@example.com");
    expect((await h.client(wes).post("/signup/business", { name: "Wes", slug: "wes-co", region: "eu" })).status).toBe(403);
    await hook(completed("sub_w", { customer_email: "paid@example.com" }));
    const paidOne = (await waiting()).find((w) => w.email === "paid@example.com")!;
    expect((await h.client(boss).del(`/platform/owner-signups/${paidOne.id}`)).status).toBe(409);
  });
});
