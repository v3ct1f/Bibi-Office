import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signStripePayload, type Billing, type CheckoutInput } from "../src/billing.ts";
import type { Mailer } from "../src/mail.ts";
import { setup } from "./harness.ts";

/** Paid sign-up: pay on Stripe (faked here), a signed webhook creates the business and invites its owner. */
const SECRET = "whsec_test_secret";
const checkouts: CheckoutInput[] = [];
const sent: { to: string; text?: string }[] = [];
const billing: Billing = {
  label: "€29 per month", webhookSecret: SECRET,
  async createCheckout(i) { checkouts.push(i); return "https://checkout.stripe.test/c/abc"; },
};
const mailer = { send: async (m: { to: string; text?: string }) => { sent.push(m); } } as unknown as Mailer;

let h: Awaited<ReturnType<typeof setup>>;
let boss: string;
beforeAll(async () => { h = await setup([], { billing, mailer }); boss = await h.token("boss"); });
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
    expect((await h.client().get("/signup/config")).body).toEqual({ open: true, price: "€29 per month" });
    const r = await h.client().post("/signup/checkout", { businessName: "Maria's Bakery", email: "Maria@Example.com" });
    expect(r.status).toBe(200);
    expect(r.body.url).toBe("https://checkout.stripe.test/c/abc");
    expect(checkouts.at(-1)).toMatchObject({ email: "maria@example.com", slug: "marias-bakery", region: "eu" });
  });

  it("refuses an address that is already taken, before any payment", async () => {
    await h.client(boss).post("/platform/businesses", { name: "Taken", slug: "taken-co", ownerEmail: "t@example.com" });
    const n = checkouts.length;
    const r = await h.client().post("/signup/checkout", { businessName: "Taken", slug: "taken-co", email: "x@example.com" });
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

describe("sign-up closed", () => {
  it("says so when Stripe isn't set up", async () => {
    const closed = await setup([], {});
    try {
      expect((await closed.client().get("/signup/config")).body).toEqual({ open: false, price: "" });
      expect((await closed.client().post("/signup/checkout", { businessName: "X", email: "x@example.com" })).status).toBe(503);
    } finally { await closed.teardown(); }
  });
});
