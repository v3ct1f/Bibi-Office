// Feature modules: off by default, only owner/admin can add or remove, role grants on enable,
// 403 while off, data kept across remove/add, and one company never sees another's data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crm from "@office/module-crm";
import invoicing from "@office/module-invoicing";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, bob: string, mia: string, max: string, tA: string, tB: string;
const A = () => h.client(alice, tA);
const B = () => h.client(bob, tB);

beforeAll(async () => {
  h = await setup([crm, invoicing]);
  [alice, bob, mia, max] = await Promise.all([h.token("alice"), h.token("bob"), h.token("mia"), h.token("max")]);
  tA = (await h.client(alice).post("/tenants", { slug: "bar-a", name: "Bar A" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "shop-b", name: "Shop B" })).body.id;
  await h.client(mia).get("/me");
  await h.client(max).get("/me");
  await A().post("/members", { email: "mia@example.com", roles: ["manager"] });
  await A().post("/members", { email: "max@example.com", roles: ["member"] });
});
afterAll(async () => { await h.teardown(); });

describe("feature modules", () => {
  it("nothing is enabled for a new company; the list carries icon, category and who can use it", async () => {
    const list = (await A().get("/modules")).body as { key: string; enabled: boolean; icon: string; category: string; roles: string[] }[];
    expect(list.map((m) => m.enabled)).toEqual([false, false]);
    const c = list.find((m) => m.key === "crm")!;
    expect(c).toMatchObject({ icon: "handshake", category: "sales", roles: ["owner", "admin", "manager", "member", "viewer"] });
    expect((await A().get("/me/access")).body.modules).toEqual([]);
  });

  it("only owner and admin can add or remove features", async () => {
    expect((await h.client(mia, tA).post("/modules/crm/enable", {})).status).toBe(403);
    expect((await h.client(max, tA).post("/modules/crm/enable", {})).status).toBe(403);
    // Make max an admin: now allowed.
    const members = (await A().get("/members")).body as { id: string; email: string }[];
    const maxId = members.find((m) => m.email === "max@example.com")!.id;
    await A().put(`/members/${maxId}/roles`, { roles: ["admin"] });
    expect((await h.client(max, tA).post("/modules/crm/enable", {})).status).toBe(200);
    expect((await h.client(max, tA).post("/modules/crm/disable", {})).status).toBe(200);
    await A().put(`/members/${maxId}/roles`, { roles: ["member"] });
  });

  it("enabling grants each role what the module lists, and records when and by whom", async () => {
    expect((await A().post("/modules/crm/enable", {})).status).toBe(200);
    const roles = (await A().get("/roles")).body as { key: string; permissions: string[] }[];
    const perms = (k: string) => roles.find((r) => r.key === k)!.permissions;
    expect(perms("admin")).toEqual(expect.arrayContaining(["crm:deal.read", "crm:deal.write", "crm:pipeline.manage"]));
    expect(perms("manager")).toEqual(expect.arrayContaining(["crm:pipeline.manage"]));
    expect(perms("member")).toEqual(expect.arrayContaining(["crm:deal.read", "crm:deal.write"]));
    expect(perms("member")).not.toContain("crm:pipeline.manage");
    expect(perms("viewer")).toContain("crm:deal.read");

    // Members can use it now; managers too.
    expect((await h.client(max, tA).post("/m/crm/deals", { title: "Catering for 40", valueCents: 120000 })).status).toBe(201);
    expect((await h.client(mia, tA).get("/m/crm/pipelines")).status).toBe(200);
    // Invoicing gives members nothing.
    await A().post("/modules/invoicing/enable", {});
    expect((await h.client(max, tA).get("/m/invoicing/invoices")).status).toBe(403);
    expect((await h.client(mia, tA).get("/m/invoicing/invoices")).status).toBe(200);

    const crmRow = ((await A().get("/modules")).body as { key: string; enabledAt: string; enabledBy: { name: string } }[]).find((m) => m.key === "crm")!;
    expect(crmRow.enabledAt).toBeTruthy();
    expect(crmRow.enabledBy.name).toBeTruthy();
    expect((await A().get("/me/access")).body.modules.map((m: { key: string }) => m.key).sort()).toEqual(["crm", "invoicing"]);
  });

  it("removing a feature hides it and returns 403, keeps the data, and adding it again restores it", async () => {
    expect((await A().post("/modules/invoicing/disable", {})).status).toBe(200);
    expect((await A().post("/modules/crm/disable", {})).status).toBe(200);

    const off = await A().get("/m/crm/deals");
    expect(off.status).toBe(403);
    expect(off.body.code).toBe("module_disabled");
    expect((await h.client(max, tA).post("/m/crm/deals", { title: "x" })).status).toBe(403);
    expect((await A().get("/me/access")).body.modules).toEqual([]);

    const row = ((await A().get("/modules")).body as { key: string; enabled: boolean; disabledAt: string; disabledBy: { name: string } }[]).find((m) => m.key === "crm")!;
    expect(row.enabled).toBe(false);
    expect(row.disabledAt).toBeTruthy();
    expect(row.disabledBy.name).toBeTruthy();
    const kept = await h.asOwner(tA, (tx) => tx`select title from crm_deals`);
    expect(kept.map((r) => r.title)).toEqual(["Catering for 40"]);

    expect((await A().post("/modules/crm/enable", {})).status).toBe(200);
    const deals = (await A().get("/m/crm/deals")).body.data as { title: string }[];
    expect(deals.map((d) => d.title)).toEqual(["Catering for 40"]);
    // Re-enabling does not create a second default pipeline.
    expect(((await A().get("/m/crm/pipelines")).body as unknown[]).length).toBe(1);
  });

  it("features are per company: another company is unaffected and never sees the data", async () => {
    // B has not added CRM, though A has.
    expect((await B().get("/m/crm/deals")).status).toBe(403);
    expect((await B().post("/modules/crm/enable", {})).status).toBe(200);
    expect((await B().get("/m/crm/deals")).body.data).toEqual([]);
    const aDeal = ((await A().get("/m/crm/deals")).body.data as { id: string }[])[0]!;
    expect((await B().get(`/m/crm/deals/${aDeal.id}`)).status).toBe(404);
    // A user of A cannot act in B by switching the tenant header (B is not even revealed to exist).
    expect((await h.client(alice, tB).get("/m/crm/deals")).status).toBe(404);
    // B removing CRM leaves A alone.
    await B().post("/modules/crm/disable", {});
    expect((await A().get("/m/crm/deals")).status).toBe(200);
  });
});
