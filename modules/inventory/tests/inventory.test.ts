import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createModuleContext, loadEnabledModule, systemContext, type ExecDeps } from "@office/platform";
import { sql } from "drizzle-orm";
import { withTenant } from "@office/db";
import { MAIL, setup } from "../../../apps/api/test/harness.ts";
import inventory from "../src/index.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, dave: string, vera: string, bob: string, tA: string, tB: string, exec: ExecDeps;
const loc: Record<string, string> = {};
const item: Record<string, string> = {};
const base = "/m/inventory";
const c = (t: string) => h.client(t, tA);
const onHand = async (id: string | undefined) => (await c(alice).get(`${base}/items/${id}`)).body;

beforeAll(async () => {
  h = await setup([inventory]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, mail: MAIL, http: { allowPrivate: true, requireHttps: false } };
  [alice, dave, vera, bob] = await Promise.all(["alice", "dave", "vera", "bob"].map((u) => h.token(u))) as [string, string, string, string];
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  for (const t of [dave, vera]) await h.client(t).get("/me");   // provisions the accounts
  await c(alice).post("/members", { email: "dave@example.com", roles: ["member"] });
  await c(alice).post("/members", { email: "vera@example.com", roles: ["viewer"] });
  expect((await c(alice).post("/modules/inventory/enable", {})).status).toBe(200);
  await h.client(bob, tB).post("/modules/inventory/enable", {});
});
afterAll(() => h?.teardown());

describe("items and locations", () => {
  it("seeds a Main location on enable; admins add more", async () => {
    const l = (await c(dave).get(`${base}/locations`)).body.data;
    expect(l.map((x: { name: string }) => x.name)).toEqual(["Main"]);
    loc.main = l[0].id;
    const v = await c(alice).post(`${base}/locations`, { name: "Van", position: 1 });
    expect(v.status).toBe(201);
    loc.van = v.body.id;
    expect((await c(alice).post(`${base}/locations`, { name: "van" })).status).toBe(409);
    expect((await c(dave).post(`${base}/locations`, { name: "Shed" })).status).toBe(403);
  });
  it("creates items with opening stock; SKU and barcode are unique per tenant", async () => {
    const r = await c(alice).post(`${base}/items`, {
      sku: "FLR-25", name: "Flour 25kg", category: "Baking", unit: "bag", cost: 1800, price: 2500, reorderPoint: 5, reorderQty: 20, barcode: "4006381333931",
      openingStock: { locationId: loc.main, quantity: 12 },
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ onHand: 12, low: false, value: 21600, currency: "EUR" });
    item.flour = r.body.id;
    item.yeast = (await c(alice).post(`${base}/items`, { sku: "YST-1", name: "Yeast", category: "Baking", unit: "kg", cost: 400, reorderPoint: 2 })).body.id;
    item.box = (await c(alice).post(`${base}/items`, { sku: "BOX-S", name: "Cake box", cost: 35 })).body.id;
    expect((await c(alice).post(`${base}/items`, { sku: "flr-25", name: "Dup" })).body.title).toBe("Another item has this SKU");
    expect((await c(alice).post(`${base}/items`, { sku: "X1", name: "Dup", barcode: "4006381333931" })).status).toBe(409);
    expect((await c(alice).post(`${base}/items`, { sku: "bad sku!", name: "X" })).status).toBe(400);
    expect((await c(dave).post(`${base}/items`, { sku: "D1", name: "X" })).status).toBe(403);
    expect((await h.events(tA, "inventory.item.created")).length).toBe(3);
    // same SKU is fine in another tenant
    expect((await h.client(bob, tB).post(`${base}/items`, { sku: "FLR-25", name: "Other flour" })).status).toBe(201);
  });
  it("lists, searches (including by barcode), filters and pages", async () => {
    const all = (await c(dave).get(`${base}/items`)).body;
    expect(all.data.map((i: { sku: string }) => i.sku)).toEqual(["BOX-S", "FLR-25", "YST-1"]);
    expect(all.categories).toEqual(["Baking"]);
    expect((await c(dave).get(`${base}/items?q=4006381333931`)).body.data).toHaveLength(1);
    expect((await c(dave).get(`${base}/items?q=yea`)).body.data[0].sku).toBe("YST-1");
    expect((await c(dave).get(`${base}/items?category=Baking`)).body.data).toHaveLength(2);
    expect((await c(dave).get(`${base}/items?low=true`)).body.data.map((i: { sku: string }) => i.sku)).toEqual(["YST-1"]);
    const p1 = (await c(dave).get(`${base}/items?limit=2`)).body;
    const p2 = (await c(dave).get(`${base}/items?limit=2&cursor=${encodeURIComponent(p1.nextCursor)}`)).body;
    expect([...p1.data, ...p2.data].map((i: { sku: string }) => i.sku)).toEqual(["BOX-S", "FLR-25", "YST-1"]);
    expect(p2.nextCursor).toBeNull();
    expect((await c(vera).get(`${base}/items`)).status).toBe(403);
    // tenant isolation
    expect((await h.client(bob, tB).get(`${base}/items/${item.flour}`)).status).toBe(404);
  });
});

describe("stock movements", () => {
  it("receives with cost and keeps a moving average cost", async () => {
    const r = await c(dave).post(`${base}/movements`, { type: "receive", itemId: item.flour, locationId: loc.main, quantity: 8, unitCost: 2100, reference: "PO-1" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ onHand: 20, cost: Math.round((12 * 1800 + 8 * 2100) / 20) });
    expect((await h.events(tA, "inventory.stock.received")).at(-1)!.payload).toMatchObject({ sku: "FLR-25", quantity: 8, onHand: 20, reference: "PO-1" });
  });
  it("issues and transfers; never below zero", async () => {
    expect((await c(dave).post(`${base}/movements`, { type: "issue", itemId: item.flour, locationId: loc.main, quantity: 3, reference: "Order 77" })).body.onHand).toBe(17);
    const t = await c(dave).post(`${base}/movements`, { type: "transfer", itemId: item.flour, locationId: loc.main, toLocationId: loc.van, quantity: 5 });
    expect(t.body.stock).toEqual([{ locationId: loc.main, location: "Main", quantity: 12 }, { locationId: loc.van, location: "Van", quantity: 5 }]);
    expect(t.body.onHand).toBe(17);
    const over = await c(dave).post(`${base}/movements`, { type: "issue", itemId: item.flour, locationId: loc.van, quantity: 6 });
    expect(over.status).toBe(409);
    expect(over.body.title).toBe("Not enough Flour 25kg in stock at that location");
    expect((await onHand(item.flour)).onHand).toBe(17);
    expect((await c(dave).post(`${base}/movements`, { type: "transfer", itemId: item.flour, locationId: loc.van, toLocationId: loc.van, quantity: 1 })).status).toBe(400);
    expect((await c(dave).post(`${base}/movements`, { type: "issue", itemId: item.flour, locationId: loc.main, quantity: 0.0001 })).status).toBe(400);
  });
  it("concurrent issues can't oversell", async () => {
    await c(dave).post(`${base}/movements`, { type: "receive", itemId: item.box, locationId: loc.main, quantity: 10 });
    const rs = await Promise.all(Array.from({ length: 6 }, () => c(dave).post(`${base}/movements`, { type: "issue", itemId: item.box, locationId: loc.main, quantity: 2 })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(5);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(1);
    expect((await onHand(item.box)).onHand).toBe(0);
  });
  it("adjustments need the adjust permission and a reason", async () => {
    expect((await c(dave).post(`${base}/movements`, { type: "adjust", itemId: item.flour, locationId: loc.main, delta: -1, note: "Torn bag" })).status).toBe(403);
    expect((await c(alice).post(`${base}/movements`, { type: "adjust", itemId: item.flour, locationId: loc.main, delta: -1 })).status).toBe(400);
    expect((await c(alice).post(`${base}/movements`, { type: "adjust", itemId: item.flour, locationId: loc.main, delta: -1, note: "Torn bag" })).body.onHand).toBe(16);
  });
  it("emits low stock once when crossing the reorder point", async () => {
    await c(dave).post(`${base}/movements`, { type: "issue", itemId: item.flour, locationId: loc.main, quantity: 11 });   // 16 → 5 (= reorder point)
    await c(dave).post(`${base}/movements`, { type: "issue", itemId: item.flour, locationId: loc.van, quantity: 1 });    // still low
    const low = (await h.events(tA, "inventory.stock.low")).filter((e) => (e.payload as { sku: string }).sku === "FLR-25");
    expect(low).toHaveLength(1);
    expect(low[0]!.payload).toMatchObject({ onHand: 5, reorderPoint: 5, reorderQty: 20 });
  });
  it("the ledger is append-only and stock can't be written directly", async () => {
    await expect(h.asOwner(tA, (tx) => tx`update inventory_movements set quantity = 100`)).rejects.toThrow(/append-only|cannot/i);
    await expect(h.asOwner(tA, (tx) => tx`delete from inventory_movements`)).rejects.toThrow(/append-only|cannot/i);
    await expect(withTenant(h.db, tA, (tx) => tx.execute(sql`update inventory_stock set quantity = 999`))).rejects.toMatchObject({ cause: { code: "42501" } });   // insufficient_privilege
  });
  it("lists movements newest first, with who did it, and pages", async () => {
    const m = (await c(dave).get(`${base}/movements?itemId=${item.flour}`)).body.data;
    expect(m.map((x: { kind: string }) => x.kind)).toEqual(["issue", "issue", "adjustment", expect.stringMatching(/^transfer_/), expect.stringMatching(/^transfer_/), "issue", "receipt", "receipt"]);
    expect(m[0]).toMatchObject({ sku: "FLR-25", by: "dave", quantity: -1 });
    expect(m.at(-1)).toMatchObject({ reference: "Opening stock" });
    expect(m[3].groupId).toBe(m[4].groupId);
    const p1 = (await c(dave).get(`${base}/movements?limit=3`)).body;
    const p2 = (await c(dave).get(`${base}/movements?limit=3&cursor=${p1.nextCursor}`)).body;
    expect(p2.data[0].id < p1.data[2].id).toBe(true);
    expect((await c(dave).get(`${base}/movements?kind=adjustment`)).body.data).toHaveLength(1);
  });
});

describe("counts, reorder and export", () => {
  it("records count differences only", async () => {
    await c(dave).post(`${base}/movements`, { type: "receive", itemId: item.yeast, locationId: loc.main, quantity: 4 });
    expect((await c(dave).post(`${base}/counts`, { locationId: loc.main, lines: [{ itemId: item.yeast, counted: 3 }] })).status).toBe(403);
    const r = await c(alice).post(`${base}/counts`, {
      locationId: loc.main, reference: "Nov count",
      lines: [{ itemId: item.flour, counted: 0 }, { itemId: item.yeast, counted: 3.5 }, { itemId: item.box, counted: 2 }],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ location: "Main", counted: 3 });
    expect(r.body.differences.map((d: { sku: string; delta: number }) => [d.sku, d.delta])).toEqual([["YST-1", -0.5], ["BOX-S", 2]]);
    expect((await onHand(item.yeast)).onHand).toBe(3.5);
    expect((await c(alice).post(`${base}/counts`, { locationId: loc.main, lines: [{ itemId: item.box, counted: 1 }, { itemId: item.box, counted: 2 }] })).status).toBe(400);
    expect((await h.events(tA, "inventory.stock.adjusted")).at(-1)!.payload).toMatchObject({ count: true, locationId: loc.main });
  });
  it("suggests what to reorder and summarizes stock value", async () => {
    const r = (await c(dave).get(`${base}/reorder`)).body.data;
    expect(r.map((x: { sku: string; suggestedQty: number }) => [x.sku, x.suggestedQty])).toEqual([["FLR-25", 20]]);
    const yeast = (await c(alice).patch(`${base}/items/${item.yeast}`, { reorderPoint: 4 })).body;
    expect(yeast.low).toBe(true);
    const r2 = (await c(dave).get(`${base}/reorder`)).body.data;
    expect(r2.find((x: { sku: string }) => x.sku === "YST-1")).toMatchObject({ onHand: 3.5, suggestedQty: 4.5 });
    const s = (await c(dave).get(`${base}/summary`)).body;
    expect(s).toMatchObject({ items: 3, lowCount: 2 });
    const flour = await onHand(item.flour);
    expect(s.stockValue).toBe(flour.value + 3.5 * 400 + 2 * 35);
  });
  it("can't archive items or locations that still hold stock", async () => {
    expect((await c(alice).patch(`${base}/items/${item.flour}`, { archived: true })).status).toBe(409);
    expect((await c(alice).patch(`${base}/locations/${loc.main}`, { archived: true })).status).toBe(409);
    const ghost = (await c(alice).post(`${base}/items`, { sku: "OLD-1", name: "Old" })).body.id;
    expect((await c(alice).patch(`${base}/items/${ghost}`, { archived: true })).body.archived).toBe(true);
    expect((await c(dave).post(`${base}/movements`, { type: "receive", itemId: ghost, locationId: loc.main, quantity: 1 })).status).toBe(422);
    expect((await c(dave).get(`${base}/items`)).body.data.map((i: { sku: string }) => i.sku)).not.toContain("OLD-1");
  });
  it("exports stock as CSV without formula injection", async () => {
    await c(alice).post(`${base}/items`, { sku: "EVIL", name: "=HYPERLINK(\"x\")", openingStock: { locationId: loc.van, quantity: 1 } });
    const r = await c(dave).get(`${base}/export.csv`);
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/csv");
    const text = String(r.body);
    expect(text).toContain("SKU,Item,Location,Quantity,Unit,Unit cost (EUR),Value (EUR)");
    expect(text).toContain("YST-1,Yeast,Main,3.5,kg,4.00,14.00");
    expect(text).toContain(`EVIL,"'=HYPERLINK(""x"")"`);
  });
});

describe("workflows", () => {
  it("issue and receive by SKU", async () => {
    await withTenant(h.db, tA, async (tx) => {
      const l = (await loadEnabledModule(tx, exec, tA, "inventory"))!;
      const ctx = createModuleContext(tx, systemContext(tA, "t", "workflow"), l.def, l.state);
      expect(await h.registry.action("inventory.receive")!.spec.run(ctx, { sku: "box-s", quantity: 10, reference: "Auto" })).toMatchObject({ sku: "BOX-S", onHand: 12 });
      expect(await h.registry.action("inventory.issue")!.spec.run(ctx, { sku: "BOX-S", quantity: 4, reference: "Order 9" })).toMatchObject({ onHand: 8, low: false });
      await expect(h.registry.action("inventory.issue")!.spec.run(ctx, { sku: "NOPE", quantity: 1 })).rejects.toThrow(/not found/i);
    });
    const m = (await c(dave).get(`${base}/movements?itemId=${item.box}&limit=1`)).body.data[0];
    expect(m).toMatchObject({ kind: "issue", reference: "Order 9", by: "Workflow" });
  });
});
