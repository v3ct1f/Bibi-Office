import { afterAll, beforeAll, describe, expect, it } from "vitest";
import workmail, { fakeProvider } from "@office/module-workmail";
import { signStripePayload, type Billing, type CheckoutInput } from "../src/billing.ts";
import { setup } from "./harness.ts";

/** Work email as a paid extra on the Stripe subscription (Stripe is faked here). */
const SECRET = "whsec_addons";
const checkouts: CheckoutInput[] = [];
const added: string[] = [];
const removed: string[] = [];
let failAdd = false;
const billing: Billing = {
  label: "€29 per month", webhookSecret: SECRET, workmailLabel: "€9 per month",
  async createCheckout(i) { checkouts.push(i); return "https://checkout.stripe.test/c/abc"; },
  async portalUrl() { return "https://billing.stripe.test/p/xyz"; },
  async addAddOn(sub) { if (failAdd) throw new Error("card declined"); added.push(sub); },
  async removeAddOn(sub) { removed.push(sub); },
  async createPayment(i) { return { url: `https://pay.stripe.test/${i.metadata.orderId}`, id: `cs_${i.metadata.orderId}` }; },
  async paymentPaid() { return true; },
};

let h: Awaited<ReturnType<typeof setup>>;
let boss: string;
beforeAll(async () => { h = await setup([workmail], { billing, workmailProvider: fakeProvider() }); boss = await h.token("boss"); });
afterAll(async () => { await h.teardown(); });

const hook = (event: object) => {
  const raw = JSON.stringify(event);
  return h.app.inject({ method: "POST", url: "/api/v1/stripe/webhook", payload: raw, headers: { "content-type": "application/json", "stripe-signature": signStripePayload(raw, SECRET) } });
};
const completed = (sub: string, email: string, slug: string, workmailTick = false) => ({
  id: `evt_${sub}`, type: "checkout.session.completed",
  data: { object: {
    mode: "subscription", payment_status: "paid", subscription: sub, customer: "cus_1", customer_email: email,
    metadata: { businessName: slug, slug, region: "eu", ...(workmailTick ? { workmail: "1" } : {}) },
  } },
});
/** Creates a paid business through the webhook and signs its owner in. */
async function paidBusiness(sub: string, user: string, slug: string, tick: boolean) {
  await hook(completed(sub, `${user}@example.com`, slug, tick));
  const biz = (await h.client(boss).get("/platform/businesses")).body.items.find((b: { slug: string }) => b.slug === slug);
  const inv = await h.client(boss).post(`/platform/businesses/${biz.id}/owner-invite`, { email: `${user}@example.com` });
  const token = await h.token(user);
  await h.client(token).get("/me");
  const acc = await h.client(token).post("/invitations/accept", { tenantId: biz.id, token: (inv.body.invitation.link as string).split("/").pop() });
  expect(acc.status).toBe(200);
  return { id: biz.id as string, c: h.client(token, biz.id) };
}

describe("Work email at sign-up", () => {
  it("shows the extra's price and passes the tick box to checkout", async () => {
    expect((await h.client().get("/signup/config")).body).toEqual({ open: true, price: "€29 per month", workmail: "€9 per month" });
    const base = { businessName: "Tick Co", email: "tick@example.com", acceptTerms: true, businessUse: true };
    await h.client().post("/signup/checkout", { ...base, workmail: true });
    expect(checkouts.at(-1)).toMatchObject({ workmail: true });
    await h.client().post("/signup/checkout", { ...base, businessName: "No Tick Co" });
    expect(checkouts.at(-1)).toMatchObject({ workmail: false });
  });

  it("skipped: the business gets its normal subscription and Work email stays off", async () => {
    const b = await paidBusiness("sub_skip", "sara", "skip-co", false);
    expect((await b.c.get("/billing/addons")).body.workmail).toMatchObject({ available: true, active: false, enabled: false, price: "€9 per month" });
    expect((await b.c.get("/m/workmail/domains")).status).toBe(403);
    expect(added).toEqual([]);
  });

  it("ticked: the business is created with Work email already on", async () => {
    const b = await paidBusiness("sub_tick", "tom", "tick-co", true);
    expect((await b.c.get("/billing/addons")).body.workmail).toMatchObject({ active: true, enabled: true });
    expect((await b.c.get("/m/workmail/domains")).body).toEqual([]);
  });
});

describe("turning Work email on later", () => {
  let b: Awaited<ReturnType<typeof paidBusiness>>;
  beforeAll(async () => { b = await paidBusiness("sub_later", "lea", "later-co", false); });

  it("can't be switched on from Add features without paying", async () => {
    const r = await b.c.post("/modules/workmail/enable", {});
    expect(r.status).toBe(402);
    expect(r.body.title).toMatch(/paid extra/);
    expect((await b.c.get("/billing/addons")).body.workmail.enabled).toBe(false);
  });

  it("adds the extra to the subscription and switches the feature on", async () => {
    failAdd = true;
    const bad = await b.c.post("/billing/addons/workmail", {});
    expect(bad.status).toBe(502);
    expect((await b.c.get("/billing/addons")).body.workmail).toMatchObject({ active: false, enabled: false });
    failAdd = false;

    const r = await b.c.post("/billing/addons/workmail", {});
    expect(r.body).toEqual({ ok: true, charged: true });
    expect(added).toEqual(["sub_later"]);
    expect((await b.c.get("/billing/addons")).body.workmail).toMatchObject({ active: true, enabled: true });
    expect((await b.c.get("/m/workmail/config")).body).toMatchObject({ available: true });
    // Doing it twice is harmless.
    expect((await b.c.post("/billing/addons/workmail", {})).status).toBe(200);
  });

  it("a domain is paid for on the payment page and finished after paying", async () => {
    const reg = { name: "Later Co", email: "lea@example.com", address: "1 High St", city: "Leeds", postalCode: "LS1", country: "GB" };
    const r = await b.c.post("/m/workmail/domains/order", { domain: "laterco.com", registrant: reg, returnPath: "/t/later-co/m/workmail/email" });
    expect(r.status).toBe(201);
    expect(r.body.redirectUrl).toMatch(/^https:\/\/pay\.stripe\.test\//);
    expect(r.body.domain.status).toBe("awaiting_payment");
    const done = await b.c.post(`/m/workmail/domains/${r.body.domain.id}/confirm`, {});
    expect(done.body.status).toBe("active");
  });

  it("taking it off stops the extra, switches the feature off and keeps the domain's records", async () => {
    expect((await b.c.del("/billing/addons/workmail")).status).toBe(200);
    expect(removed).toEqual(["sub_later"]);
    expect((await b.c.get("/billing/addons")).body.workmail).toMatchObject({ active: false, enabled: false });
    expect((await b.c.get("/m/workmail/domains")).status).toBe(403);
    const rows = await h.asOwner(b.id, (tx) => tx`select name, status from workmail_domains`);
    expect(rows).toEqual([{ name: "laterco.com", status: "active" }]);
  });
});

describe("a business without a Stripe subscription", () => {
  it("turns it on at no extra charge", async () => {
    const made = await h.client(boss).post("/platform/businesses", { name: "Free Co", slug: "free-co", ownerEmail: "fred@example.com" });
    const fred = await h.token("fred");
    await h.client(fred).get("/me");
    await h.client(fred).post("/invitations/accept", { tenantId: made.body.business.id, token: (made.body.invitation.link as string).split("/").pop() });
    const c = h.client(fred, made.body.business.id);
    const n = added.length;
    expect((await c.get("/billing/addons")).body.workmail).toMatchObject({ available: true, price: null });
    expect((await c.post("/billing/addons/workmail", {})).body).toEqual({ ok: true, charged: false });
    expect(added.length).toBe(n);
    expect((await c.get("/m/workmail/domains")).status).toBe(200);
  });
});
