import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crm from "@office/module-crm";
import invoicing from "@office/module-invoicing";
import workmail, { fakeProvider } from "@office/module-workmail";
import type { Mailer } from "../src/mail.ts";
import { setup } from "./harness.ts";

/**
 * The "Add work email" step of the sign-up (demo payments, pretend provider): the prices from the one shared place,
 * checking a domain is free, the choice going through the demo checkout, and the new business getting Work email on.
 */
const sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = { send: async (m) => { sent.push(m); } };

let h: Awaited<ReturnType<typeof setup>>;
let boss: string;
beforeAll(async () => {
  h = await setup([crm, invoicing, workmail], { mailer, testPayments: true, workmailProvider: fakeProvider() });
  boss = await h.token("boss");
});
afterAll(async () => { await h.teardown(); });

const SIGNUP = { acceptTerms: true, businessUse: true };
const demoId = (url: string) => url.match(/\/start\/demo-pay\/([A-Za-z0-9_-]+)$/)![1]!;
/** Pays on the demo page, signs the payer in and creates their business. */
async function signUp(user: string, body: Record<string, unknown>) {
  const r = await h.client().post("/signup/checkout", { ...SIGNUP, email: `${user}@example.com`, ...body });
  expect(r.status).toBe(200);
  const id = demoId(r.body.url);
  const page = (await h.client().get(`/signup/demo/${id}`)).body;
  expect((await h.client().post(`/signup/demo/${id}/pay`, {})).status).toBe(200);
  const token = await h.token(user, `${user}@example.com`);
  await h.client(token).get("/me");
  const made = await h.client(token).post("/signup/business", { name: `${user} co`, slug: `${user}-co`, region: "eu" });
  expect(made.status).toBe(201);
  return { page, made: made.body, c: h.client(token, made.body.id) };
}

describe("Work email prices", () => {
  it("come from the one shared place and are on the sign-up config", async () => {
    expect((await h.client().get("/signup/config")).body).toEqual({
      open: true, price: "", testMode: true,
      workmail: { domainPerYear: 19, mailboxPerMonth: 3, exampleMailboxes: 5, maxMailboxes: 500, currency: "EUR" },
    });
  });
});

describe("checking a domain during sign-up", () => {
  it("says whether the name is free, at our price (never below €19 a year)", async () => {
    const r = await h.client().get("/signup/domain-check?q=BibiBakery.com");
    expect(r.status).toBe(200);
    const offers = r.body.offers as { domain: string; available: boolean; pricePerYear: number | null }[];
    expect(offers[0]).toMatchObject({ domain: "bibibakery.com", available: true, pricePerYear: 19 });
    // The provider sells .eu for less: the customer still pays our standard price. A dearer ending costs what it costs.
    expect(offers.find((o) => o.domain === "bibibakery.eu")).toMatchObject({ pricePerYear: 19 });
    expect(offers.find((o) => o.domain === "bibibakery.io")!.pricePerYear).toBeGreaterThan(19);
  });

  it("says when a name is taken, and refuses nonsense", async () => {
    const r = await h.client().get("/signup/domain-check?q=takenbakery.com");
    expect(r.body.offers[0]).toMatchObject({ domain: "takenbakery.com", available: false });
    expect((await h.client().get("/signup/domain-check?q=")).status).toBe(400);
    expect((await h.client().get(`/signup/domain-check?q=${"a".repeat(300)}`)).status).toBe(400);
  });
});

describe("signing up with Work email", () => {
  it("refuses an impossible choice", async () => {
    const bad = (workmail: unknown) => h.client().post("/signup/checkout", { ...SIGNUP, email: "x@example.com", plan: "starter", workmail });
    expect((await bad({ mailboxes: 0 })).status).toBe(400);
    expect((await bad({ mailboxes: 501 })).status).toBe(400);
    expect((await bad({ mailboxes: 2, domain: "not a domain" })).status).toBe(400);
  });

  let owner: Awaited<ReturnType<typeof signUp>>;
  it("the demo checkout shows the extra, and the new business has Work email on with the domain remembered", async () => {
    owner = await signUp("wendy", { plan: "starter", interval: "monthly", workmail: { mailboxes: 5, domain: "WendysWidgets.com" } });
    expect(owner.page).toMatchObject({ plan: { key: "starter", monthly: 29 }, workmail: { mailboxes: 5, domain: "wendyswidgets.com" }, prices: { mailboxPerMonth: 3, domainPerYear: 19 } });
    const waiting = (await h.client(boss).get("/platform/owner-signups")).body.items;
    expect(waiting.find((w: { email: string }) => w.email === "wendy@example.com")).toBeUndefined();   // used straight away
    expect(owner.made).toMatchObject({ plan: "starter", workmail: { mailboxes: 5, domain: "wendyswidgets.com", on: true } });
    expect((await owner.c.get("/billing/addons")).body.workmail).toMatchObject({ active: true, enabled: true });
    expect((await owner.c.get("/m/workmail/domains")).body).toEqual([]);   // nothing bought yet: that's the next step
    // A demo business sees the real price per mailbox, marked as demo (nothing is charged).
    expect((await owner.c.get("/m/workmail/config")).body).toMatchObject({ mailboxesUsed: 0, mailboxPrice: { perMonth: 3, currency: "EUR", mode: "demo" } });
    expect((await owner.c.get("/billing/addons")).body.workmail).toMatchObject({ price: null, mailbox: { perMonth: 3, mode: "demo" } });
    const offers = (await owner.c.get("/m/workmail/domains/search?q=wendyswidgets.com")).body as { domain: string; priceCents: number }[];
    expect(offers[0]).toMatchObject({ domain: "wendyswidgets.com", priceCents: 1900 });
  });

  it("Work email stays on when the plan changes (it's an extra on top of any plan)", async () => {
    expect((await owner.c.post("/billing/plan", { plan: "business", interval: "monthly" })).status).toBe(200);
    expect((await owner.c.get("/billing/addons")).body.workmail).toMatchObject({ active: true, enabled: true });
    expect((await owner.c.post("/billing/plan", { plan: "starter", interval: "monthly" })).status).toBe(200);
    expect((await owner.c.get("/billing/addons")).body.workmail).toMatchObject({ active: true, enabled: true });
    expect((await owner.c.get("/m/workmail/domains")).status).toBe(200);
  });

  it("works without a domain too (they'll connect their own)", async () => {
    const o = await signUp("dora", { plan: "business", workmail: { mailboxes: 2 } });
    expect(o.page.workmail).toEqual({ mailboxes: 2, domain: null });
    expect(o.made.workmail).toEqual({ mailboxes: 2, domain: null, on: true });
  });

  it("skipped: the business still has Work email (it's built in), and nothing extra is charged", async () => {
    const o = await signUp("sam", { plan: "starter" });
    expect(o.page.workmail).toBeNull();
    expect(o.made.workmail).toBeNull();
    expect((await o.c.get("/billing/addons")).body.workmail).toMatchObject({ active: false, enabled: true });
    expect((await o.c.get("/m/workmail/domains")).status).toBe(200);
  });

});
