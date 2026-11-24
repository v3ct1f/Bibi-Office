import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crm from "@office/module-crm";
import invoicing from "@office/module-invoicing";
import expenses from "@office/module-expenses";
import support from "@office/module-support";
import type { Mailer } from "../src/mail.ts";
import { setup } from "./harness.ts";

/**
 * Subscription plans with a pretend payment: the landing page's plans, signing up on one, features and the people limit
 * following the plan, and upgrading / downgrading inside the app.
 */
const sent: { to: string; subject: string; text: string }[] = [];
const mailer: Mailer = { send: async (m) => { sent.push(m); } };

let h: Awaited<ReturnType<typeof setup>>;
let boss: string, maria: string, nina: string;
let tenantId: string;
const M = () => h.client(maria, tenantId);
const SIGNUP = { businessName: "Maria's Cafe", email: "Maria@Example.com", acceptTerms: true, businessUse: true };

beforeAll(async () => {
  h = await setup([crm, invoicing, expenses, support], { mailer, testPayments: true });
  [boss, maria, nina] = await Promise.all([h.token("boss"), h.token("maria"), h.token("nina")]);
});
afterAll(async () => { await h.teardown(); });

const listed = async (slug: string) => (await h.client(boss).get("/platform/businesses")).body.items.find((b: { slug: string }) => b.slug === slug);

describe("plans on the landing page", () => {
  it("lists the three plans with prices, people and features, without signing in", async () => {
    const r = await h.client().get("/plans");
    expect(r.status).toBe(200);
    expect(r.body.testMode).toBe(true);
    const plans = r.body.plans as { key: string; monthly: number; yearly: number; people: number; features: { key: string; name: string }[]; capabilities: string[] }[];
    expect(plans.map((p) => [p.key, p.monthly, p.yearly, p.people])).toEqual([
      ["starter", 29, 290, 15], ["business", 79, 790, 30], ["complete", 149, 1490, 60],
    ]);
    expect(plans[0]!.features.map((f) => f.key)).toEqual(expect.arrayContaining(["invoicing", "crm"]));
    expect(plans[0]!.features.every((f) => f.name.length > 0)).toBe(true);
    expect(plans[2]!.capabilities).toEqual(["api", "workflows"]);
    expect(plans[0]!.capabilities).toEqual([]);
  });
});

describe("test sign-up", () => {
  it("needs the terms and business use ticked, and refuses a taken address", async () => {
    expect((await h.client().post("/signup/test-checkout", { ...SIGNUP, plan: "starter", acceptTerms: false })).status).toBe(400);
    expect((await h.client().post("/signup/test-checkout", { ...SIGNUP, plan: "starter", businessUse: false })).status).toBe(400);
    expect((await h.client().post("/signup/test-checkout", { ...SIGNUP, plan: "nope" })).status).toBe(400);
    await h.client(boss).post("/platform/businesses", { name: "Taken", slug: "taken-co", ownerEmail: "t@example.com" });
    expect((await h.client().post("/signup/test-checkout", { ...SIGNUP, plan: "starter", slug: "taken-co" })).status).toBe(409);
  });

  it("creates the business on the chosen plan and emails the owner the link", async () => {
    const before = sent.length;
    const r = await h.client().post("/signup/test-checkout", { ...SIGNUP, plan: "starter", interval: "yearly" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ ok: true, emailed: true, plan: "starter" });
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.to).toBe("maria@example.com");
    // Starter: only the starter features may be turned on.
    expect(await listed("marias-cafe")).toMatchObject({ name: "Maria's Cafe", ownerInvite: { email: "maria@example.com" } });
    const link = sent.at(-1)!.text.match(/\/invite\/([0-9a-f-]{36})\/([A-Za-z0-9_-]{43})/)!;
    tenantId = link[1]!;
    const acc = await h.client(maria).post("/invitations/accept", { tenantId, token: link[2] });
    expect(acc.status).toBe(200);
  });

  it("is closed when test payments are off", async () => {
    const off = await setup([crm], { mailer });
    try {
      expect((await off.client().get("/signup/config")).body).toMatchObject({ open: false, testMode: false });
      expect((await off.client().post("/signup/test-checkout", { ...SIGNUP, plan: "starter" })).status).toBe(503);
    } finally { await off.teardown(); }
  });
});

describe("the plan sets what a business can use", () => {
  it("shows the current plan and how many people are used", async () => {
    const r = (await M().get("/billing/plan")).body;
    expect(r.current).toMatchObject({ key: "starter", interval: "yearly", test: true, stripe: false, people: 1 });
    expect(r.current.plan.people).toBe(15);
    expect(r.plans).toHaveLength(3);
  });

  it("starter can use its own features but not the ones of bigger plans", async () => {
    expect((await M().post("/modules/crm/enable", {})).status).toBe(200);
    const list = (await M().get("/modules")).body as { key: string; allowed: boolean }[];
    expect(list.find((m) => m.key === "crm")!.allowed).toBe(true);
    expect(list.find((m) => m.key === "expenses")!.allowed).toBe(false);
    expect(list.find((m) => m.key === "support")!.allowed).toBe(false);
    expect((await M().post("/modules/expenses/enable", {})).status).toBe(403);
  });

  it("API keys, webhooks and workflows are only in Complete", async () => {
    const key = await M().post("/api-keys", { name: "zapier", scopes: ["core:contacts.read"] });
    expect(key.status).toBe(402);
    expect(key.body.error?.code ?? key.body.code).toBe("plan_feature");
    expect((await M().post("/webhooks", { url: "https://example.com/hook", events: ["core.member.added"] })).status).toBe(402);
    expect((await M().post("/workflows", { name: "w", trigger: { event: "core.company.created" }, actions: [{ key: "crm.log_activity", input: { dealId: "x", body: "y" } }] })).status).toBe(402);
  });

  it("stops adding people at the limit, counting waiting invitations", async () => {
    // Maria is person 1; 14 invitations make 15.
    for (let i = 1; i <= 14; i++) {
      expect((await M().post("/invitations", { email: `p${i}@example.com`, roles: ["member"] })).status).toBe(201);
    }
    const over = await M().post("/invitations", { email: "p15@example.com", roles: ["member"] });
    expect(over.status).toBe(402);
    expect(JSON.stringify(over.body)).toContain("includes 15 people");
    // Re-inviting someone who already has an invitation doesn't use another place.
    expect((await M().post("/invitations", { email: "p3@example.com", roles: ["member"] })).status).toBe(201);
    expect((await M().get("/billing/plan")).body.current.people).toBe(15);
  });

  it("only owners and admins can change the plan", async () => {
    const invites = (await M().get("/invitations")).body as { id: string; email: string }[];
    await M().del(`/invitations/${invites.find((i) => i.email === "p1@example.com")!.id}`);
    await h.client(nina).get("/me");
    await h.join(tenantId, maria, nina, ["member"]);
    expect((await h.client(nina, tenantId).post("/billing/plan", { plan: "business" })).status).toBe(403);
    expect((await h.client(nina, tenantId).get("/billing/plan")).status).toBe(200);
  });

  it("upgrading changes the features at once and takes effect without any payment", async () => {
    const r = await M().post("/billing/plan", { plan: "business", interval: "monthly" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ plan: "business", interval: "monthly", turnedOff: [] });
    expect((await M().get("/billing/plan")).body.current).toMatchObject({ key: "business", interval: "monthly" });
    expect((await M().post("/modules/expenses/enable", {})).status).toBe(200);
    expect((await M().post("/modules/support/enable", {})).status).toBe(403);
    expect((await M().post("/api-keys", { name: "k", scopes: ["core:contacts.read"] })).status).toBe(402);
    // The limit grew from 15 to 30.
    expect((await M().post("/invitations", { email: "p15@example.com", roles: ["member"] })).status).toBe(201);
  });

  it("complete opens everything, including API keys", async () => {
    expect((await M().post("/billing/plan", { plan: "complete" })).status).toBe(200);
    expect((await M().post("/modules/support/enable", {})).status).toBe(200);
    expect((await M().post("/api-keys", { name: "zapier", scopes: ["core:contacts.read"] })).status).toBe(201);
  });

  it("choosing the plan you're already on is refused, and an unknown plan too", async () => {
    expect((await M().post("/billing/plan", { plan: "complete", interval: "monthly" })).status).toBe(409);
    expect((await M().post("/billing/plan", { plan: "gold" })).status).toBe(400);
  });

  it("downgrading is refused while the team is too big, and turns features off (keeping data) once it fits", async () => {
    // 16 people now (Maria, Nina, 14 waiting): Starter includes 15.
    const refused = await M().post("/billing/plan", { plan: "starter" });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.body)).toContain("Remove 1 first");
    const invites = (await M().get("/invitations")).body as { id: string; email: string }[];
    await M().del(`/invitations/${invites.find((i) => i.email === "p2@example.com")!.id}`);
    const ok = await M().post("/billing/plan", { plan: "starter" });
    expect(ok.status).toBe(200);
    expect(ok.body.turnedOff).toEqual(expect.arrayContaining(["expenses", "support"]));
    const list = (await M().get("/modules")).body as { key: string; enabled: boolean; allowed: boolean }[];
    expect(list.find((m) => m.key === "expenses")).toMatchObject({ enabled: false, allowed: false });
    expect(list.find((m) => m.key === "crm")).toMatchObject({ enabled: true, allowed: true });
    // Existing API keys stay, but no new one can be made.
    expect((await M().post("/api-keys", { name: "again", scopes: ["core:contacts.read"] })).status).toBe(402);
    expect((await M().get("/api-keys")).body).toHaveLength(1);
  });

  it("the change is in the audit log", async () => {
    const rows = (await M().get("/audit?entityType=tenant")).body.data as { action: string }[];
    expect(rows.filter((r) => r.action === "tenant.plan_changed").length).toBeGreaterThanOrEqual(3);
  });
});

describe("businesses without a plan", () => {
  it("made before plans existed have no limits and keep every feature", async () => {
    const t = (await h.client(nina).post("/tenants", { slug: "old-shop", name: "Old Shop" })).body;
    const N = () => h.client(nina, t.id);
    const cur = (await N().get("/billing/plan")).body.current;
    expect(cur).toMatchObject({ key: "free", plan: null });
    expect((await N().post("/modules/expenses/enable", {})).status).toBe(200);
    expect((await N().post("/api-keys", { name: "k", scopes: ["core:contacts.read"] })).status).toBe(201);
    for (let i = 1; i <= 16; i++) expect((await N().post("/invitations", { email: `q${i}@example.com`, roles: ["member"] })).status).toBe(201);
  });
});
