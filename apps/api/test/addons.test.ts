import { afterAll, beforeAll, describe, expect, it } from "vitest";
import workmail, { fakeProvider } from "@office/module-workmail";
import { signStripePayload, type Billing, type CheckoutInput } from "../src/billing.ts";
import { setup } from "./harness.ts";

/** Work email as a paid extra on the Stripe subscription (Stripe is faked here). */
const SECRET = "whsec_addons";
const checkouts: CheckoutInput[] = [];
const added: string[] = [];
const removed: string[] = [];
const quantities: [string, number][] = [];
let failAdd = false, failQuantity = false;
const billing: Billing = {
  label: "€29 per month", webhookSecret: SECRET, workmailLabel: "per mailbox",
  async createCheckout(i) { checkouts.push(i); return "https://checkout.stripe.test/c/abc"; },
  async portalUrl() { return "https://billing.stripe.test/p/xyz"; },
  async addAddOn(sub) { if (failAdd) throw new Error("card declined"); added.push(sub); },
  async removeAddOn(sub) { removed.push(sub); },
  async setAddOnQuantity(sub, _k, n) { if (failQuantity) throw new Error("card declined"); quantities.push([sub, n]); },
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
const completed = (sub: string, email: string) => ({
  id: `evt_${sub}`, type: "checkout.session.completed",
  data: { object: { mode: "subscription", payment_status: "paid", subscription: sub, customer: "cus_1", customer_email: email, metadata: {} } },
});
/** A paid sign-up through the webhook; the owner signs in and creates their business. */
async function paidBusiness(sub: string, user: string, slug: string) {
  expect((await hook(completed(sub, `${user}@example.com`))).statusCode).toBe(200);
  const token = await h.token(user);
  await h.client(token).get("/me");
  const made = await h.client(token).post("/signup/business", { name: slug, slug, region: "eu" });
  expect(made.status).toBe(201);
  return { id: made.body.id as string, c: h.client(token, made.body.id) };
}

describe("Work email at sign-up with real (Stripe) payments", () => {
  it("isn't offered during sign-up yet: it's added from Add features after", async () => {
    expect((await h.client().get("/signup/config")).body).toMatchObject({ open: true, price: "€29 per month", workmail: null });
    const base = { email: "tick@example.com", acceptTerms: true, businessUse: true };
    const r = await h.client().post("/signup/checkout", { ...base, workmail: { mailboxes: 3 } });
    expect(r.status).toBe(400);
    expect(r.body.title).toMatch(/Add features/);
    const n = checkouts.length;
    expect((await h.client().post("/signup/checkout", base)).status).toBe(200);
    expect(checkouts.length).toBe(n + 1);
    expect(checkouts.at(-1)!.workmail).toBeUndefined();
    expect((await h.client().get("/signup/domain-check?q=tickco")).status).toBe(503);
  });

  it("the new business has its normal subscription and Work email stays off", async () => {
    const b = await paidBusiness("sub_skip", "sara", "skip-co");
    expect((await b.c.get("/billing/addons")).body.workmail).toMatchObject({
      available: true, active: false, enabled: false, price: "€3 per mailbox per month", mailbox: { perMonth: 3, currency: "EUR", mode: "stripe" },
    });
    expect((await b.c.get("/m/workmail/domains")).status).toBe(403);
    expect(added).toEqual([]);
  });
});

describe("turning Work email on later", () => {
  let b: Awaited<ReturnType<typeof paidBusiness>>;
  beforeAll(async () => { b = await paidBusiness("sub_later", "lea", "later-co"); });

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

  it("each mailbox is billed: the subscription's Work email line follows the number of mailboxes, and says so first", async () => {
    const cfg = (await b.c.get("/m/workmail/config")).body;
    expect(cfg).toMatchObject({ mailboxesUsed: 0, maxMailboxes: 10, mailboxPrice: { perMonth: 3, currency: "EUR", mode: "stripe" } });
    const [dom] = (await b.c.get("/m/workmail/domains")).body as { id: string }[];
    const anna = await b.c.post("/m/workmail/mailboxes", { domainId: dom!.id, localPart: "anna", name: "Anna" });
    expect(anna.status).toBe(201);
    expect(quantities.at(-1)).toEqual(["sub_later", 1]);
    const ben = await b.c.post("/m/workmail/mailboxes", { domainId: dom!.id, localPart: "ben", name: "Ben" });
    expect(quantities.at(-1)).toEqual(["sub_later", 2]);
    expect((await b.c.get("/m/workmail/config")).body.mailboxesUsed).toBe(2);
    // If the subscription can't be raised, the mailbox isn't made (nobody gets an unpaid mailbox).
    failQuantity = true;
    const bad = await b.c.post("/m/workmail/mailboxes", { domainId: dom!.id, localPart: "cleo", name: "Cleo" });
    failQuantity = false;
    expect(bad.status).toBe(409);
    expect(bad.body.title).toMatch(/couldn't be added to your subscription/);
    expect((await b.c.get("/m/workmail/config")).body.mailboxesUsed).toBe(2);
    // Switching one off keeps it (still billed); deleting it lowers the count.
    await b.c.post(`/m/workmail/mailboxes/${ben.body.id}/suspend`, {});
    expect((await b.c.get("/m/workmail/config")).body.mailboxesUsed).toBe(2);
    expect((await b.c.del(`/m/workmail/mailboxes/${ben.body.id}`)).status).toBe(204);
    expect(quantities.at(-1)).toEqual(["sub_later", 1]);
    expect((await b.c.get("/m/workmail/config")).body.mailboxesUsed).toBe(1);
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
    expect((await c.get("/billing/addons")).body.workmail).toMatchObject({ available: true, price: null, mailbox: { perMonth: 3, mode: "free" } });
    expect((await c.post("/billing/addons/workmail", {})).body).toEqual({ ok: true, charged: false });
    expect(added.length).toBe(n);
    expect((await c.get("/m/workmail/domains")).status).toBe(200);
  });
});
