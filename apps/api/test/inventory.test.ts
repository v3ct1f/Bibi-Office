import { afterAll, beforeAll, describe, expect, it } from "vitest";
import inventory from "@office/module-inventory";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let owner: string, mia: string, max: string, vic: string, bob: string, tA: string, tB: string;
const M = "/m/inventory";
const Own = () => h.client(owner, tA);
const Mgr = () => h.client(mia, tA);
const Max = () => h.client(max, tA);
const Vic = () => h.client(vic, tA);
const B = () => h.client(bob, tB);

let fresh: string, drinks: string;           // suppliers (core companies)
let milk: string, beans: string, cups: string, lemons: string;

beforeAll(async () => {
  h = await setup([inventory]);
  [owner, mia, max, vic, bob] = await Promise.all(["olga", "mia", "max", "vic", "bob"].map((n) => h.token(n))) as [string, string, string, string, string];
  tA = (await h.client(owner).post("/tenants", { slug: "cafe", name: "Cafe" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "deli", name: "Deli" })).body.id;
  for (const [t, role] of [[mia, "manager"], [max, "member"], [vic, "viewer"]] as const) {
    await h.join(tA, owner, t, [role]);
  }
  fresh = (await Own().post("/companies", { name: "Fresh Farms" })).body.id;
  drinks = (await Own().post("/companies", { name: "Drinks Co" })).body.id;
});
afterAll(async () => { await h.teardown(); });

describe("inventory module", () => {
  it("is off until added; roles decide who can do what", async () => {
    expect((await Mgr().get(`${M}/items`)).status).toBe(403);
    await Own().post("/modules/inventory/enable", {});
    expect((await Max().get(`${M}/config`)).body).toMatchObject({ currency: "EUR", canAdjust: true, canManage: false });
    expect((await Vic().get(`${M}/config`)).body).toMatchObject({ canAdjust: false, canManage: false });
    expect((await Max().post(`${M}/items`, { name: "Milk", unit: "l", minStock: 1, unitCostCents: 90 })).status).toBe(403);
  });

  it("adds items with validation and clear duplicate errors", async () => {
    let r = await Mgr().post(`${M}/items`, { name: "Milk", category: "Dairy", unit: "l", stock: 12, minStock: 10, supplierId: fresh, unitCostCents: 95 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ stock: 12, low: false, supplierName: "Fresh Farms", valueCents: 1140 });
    expect(r.body.history[0]).toMatchObject({ reason: "count", delta: 12, note: "Starting stock" });
    milk = r.body.id;
    beans = (await Mgr().post(`${M}/items`, { name: "Coffee beans", sku: "CB-1", category: "Coffee", unit: "kg", stock: 1.5, minStock: 2, reorderQty: 5, supplierId: drinks, unitCostCents: 1800 })).body.id;
    cups = (await Mgr().post(`${M}/items`, { name: "Paper cups", unit: "pack", stock: 3, minStock: 4, supplierId: drinks, unitCostCents: 450 })).body.id;
    lemons = (await Mgr().post(`${M}/items`, { name: "Lemons", unit: "kg", stock: 0, minStock: 1, unitCostCents: 200 })).body.id; // no supplier

    r = await Mgr().post(`${M}/items`, { name: "milk", unit: "l", minStock: 0, unitCostCents: 0 });
    expect(r.status).toBe(409);
    expect(r.body.title).toContain("already an item called");
    expect((await Mgr().post(`${M}/items`, { name: "Beans 2", sku: "cb-1", unit: "kg", minStock: 0, unitCostCents: 0 })).body.title).toMatch(/SKU cb-1 is already used/);
    expect((await Mgr().post(`${M}/items`, { name: "X", unit: "kg", minStock: -1, unitCostCents: 0 })).status).toBe(400);
    expect((await Mgr().post(`${M}/items`, { name: "X", unit: "kg", minStock: 0.0001, unitCostCents: 0 })).status).toBe(400);
    expect((await Mgr().post(`${M}/items`, { name: "X", unit: "kg", minStock: 0, unitCostCents: 0, supplierId: "019a0000-0000-7000-8000-000000000000" })).body.title).toMatch(/supplier doesn't exist/);

    const list = (await Vic().get(`${M}/items`)).body;
    expect(list.data.map((i: { name: string }) => i.name)).toEqual(["Coffee beans", "Lemons", "Milk", "Paper cups"]);
    expect(list.lowCount).toBe(3);
    expect((await Vic().get(`${M}/items?low=true&q=cup`)).body.data).toHaveLength(1);
  });

  it("stock changes need a reason, can't go below zero, and are all logged", async () => {
    let r = await Max().post(`${M}/items/${milk}/adjust`, { reason: "usage", quantity: 1.5, note: "Breakfast" });
    expect(r.body.stock).toBe(10.5);
    r = await Max().post(`${M}/items/${milk}/adjust`, { reason: "waste", quantity: 1, note: "Expired" });
    expect(r.body).toMatchObject({ stock: 9.5, low: true });
    r = await Max().post(`${M}/items/${milk}/adjust`, { reason: "usage", quantity: 20 });
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/Only 9\.5 l of Milk in stock/);
    expect((await Max().post(`${M}/items/${milk}/adjust`, { reason: "delivery", quantity: 0 })).status).toBe(400);
    expect((await Max().post(`${M}/items/${milk}/adjust`, { reason: "theft", quantity: 1 })).status).toBe(400);
    r = await Max().post(`${M}/items/${milk}/adjust`, { reason: "count", quantity: 9, note: "Weekly count" });
    expect(r.body.stock).toBe(9);
    expect((await Max().post(`${M}/items/${milk}/adjust`, { reason: "count", quantity: 9 })).status).toBe(400);
    expect((await Vic().post(`${M}/items/${milk}/adjust`, { reason: "usage", quantity: 1 })).status).toBe(403);

    const hist = (await Vic().get(`${M}/movements?itemId=${milk}`)).body;
    expect(hist.data.map((m: { reason: string; delta: number; stockAfter: number }) => [m.reason, m.delta, m.stockAfter]))
      .toEqual([["count", -0.5, 9], ["waste", -1, 9.5], ["usage", -1.5, 10.5], ["count", 12, 12]]);
    expect(hist.data[0].actorName).toBeTruthy();
    expect((await Vic().get(`${M}/movements?reason=waste`)).body.data[0].note).toBe("Expired");
    // Crossing the minimum emits one low-stock event.
    const low = await h.events(tA, "inventory.stock.low");
    expect(low.map((e: { payload: { name: string } }) => e.payload.name)).toEqual(["Milk"]);
  });

  it("generates one purchase order per supplier for low items, skipping ones it can't order", async () => {
    const s = (await Vic().get(`${M}/summary`)).body;
    expect(s).toMatchObject({ lowCount: 4, notOrdered: 4, drafts: 0 });
    expect((await Max().post(`${M}/orders/generate`, {})).status).toBe(403);
    const g = (await Mgr().post(`${M}/orders/generate`, {})).body;
    expect(g.created.map((c: { supplierName: string; lineCount: number }) => [c.supplierName, c.lineCount]).sort())
      .toEqual([["Drinks Co", 2], ["Fresh Farms", 1]]);
    expect(g.skipped).toEqual([{ itemId: lemons, name: "Lemons", reason: "has no supplier" }]);
    expect(g.created.map((c: { number: string }) => c.number).sort()).toEqual(["PO-0001", "PO-0002"]);

    const again = (await Mgr().post(`${M}/orders/generate`, {})).body;
    expect(again.created).toEqual([]);
    expect(again.skipped.filter((x: { reason: string }) => x.reason === "already on an open order")).toHaveLength(3);

    const drinksPo = (await Mgr().get(`${M}/orders?status=open`)).body.find((o: { supplierName: string }) => o.supplierName === "Drinks Co");
    const po = (await Vic().get(`${M}/orders/${drinksPo.id}`)).body;
    // Beans: reorder amount 5. Cups: back to twice the minimum (8 - 3 = 5).
    expect(po.lines.map((l: { itemName: string; quantity: number; unitCostCents: number }) => [l.itemName, l.quantity, l.unitCostCents]))
      .toEqual([["Coffee beans", 5, 1800], ["Paper cups", 5, 450]]);
    expect(po.totalCents).toBe(5 * 1800 + 5 * 450);
    expect(po.can).toMatchObject({ edit: true, send: true, delete: true });
    expect((await Vic().get(`${M}/items/${beans}`)).body.openOrders[0].number).toBe(po.number);
  });

  it("orders can be edited, sent and received; receiving updates stock and cost", async () => {
    const po = (await Mgr().get(`${M}/orders?status=draft`)).body.find((o: { supplierName: string }) => o.supplierName === "Drinks Co");
    let r = await Mgr().patch(`${M}/orders/${po.id}`, { lines: [{ itemId: beans, quantity: 6, unitCostCents: 1750 }, { itemId: cups, quantity: 4 }], notes: "Deliver before 10" });
    expect(r.body.lines.map((l: { quantity: number; unitCostCents: number }) => [l.quantity, l.unitCostCents])).toEqual([[6, 1750], [4, 450]]);
    expect((await Mgr().patch(`${M}/orders/${po.id}`, { lines: [{ itemId: beans, quantity: 1 }, { itemId: beans, quantity: 2 }] })).body.title).toMatch(/twice/);
    expect((await Mgr().patch(`${M}/orders/${po.id}`, { lines: [{ itemId: beans, quantity: 0 }] })).status).toBe(400);

    r = await Mgr().post(`${M}/orders/${po.id}/send`, {});
    expect(r.body.status).toBe("sent");
    expect((await Mgr().post(`${M}/orders/${po.id}/send`, {})).status).toBe(409);
    expect((await Mgr().del(`${M}/orders/${po.id}`)).status).toBe(409);

    // Cups arrived short: 3 of 4.
    const cupsLine = r.body.lines.find((l: { itemName: string }) => l.itemName === "Paper cups").id;
    r = await Mgr().post(`${M}/orders/${po.id}/receive`, { lines: [{ lineId: cupsLine, receivedQty: 3 }], note: "1 pack missing" });
    expect(r.body).toMatchObject({ status: "received", can: { edit: false, receive: false } });
    expect((await Mgr().post(`${M}/orders/${po.id}/receive`, {})).status).toBe(409);
    expect((await Mgr().patch(`${M}/orders/${po.id}`, { notes: "x" })).status).toBe(409);

    const b = (await Vic().get(`${M}/items/${beans}`)).body;
    expect(b).toMatchObject({ stock: 7.5, unitCostCents: 1750, low: false, onOrder: 0 });
    expect(b.history[0]).toMatchObject({ reason: "delivery", delta: 6, orderNumber: po.number });
    expect((await Vic().get(`${M}/items/${cups}`)).body.stock).toBe(6);
    expect((await h.events(tA, "inventory.order.received")).length).toBe(1);
  });

  it("manual orders, cancel and delete; archived items keep their history", async () => {
    let r = await Mgr().post(`${M}/orders`, { supplierId: fresh, lines: [{ itemId: lemons, quantity: 3 }] });
    expect(r.status).toBe(201);
    const manual = r.body;
    expect((await Mgr().del(`${M}/items/${lemons}`)).body.title).toMatch(/open purchase order PO-0003/);
    expect((await Mgr().post(`${M}/orders/${manual.id}/cancel`, {})).body.status).toBe("cancelled");
    expect((await Mgr().del(`${M}/items/${lemons}`)).status).toBe(204);
    expect((await Vic().get(`${M}/items`)).body.data.map((i: { name: string }) => i.name)).not.toContain("Lemons");
    expect((await Vic().get(`${M}/items?archived=true`)).body.data.map((i: { name: string }) => i.name)).toEqual(["Lemons"]);
    expect((await Max().post(`${M}/items/${lemons}/adjust`, { reason: "delivery", quantity: 1 })).status).toBe(409);
    expect((await Mgr().patch(`${M}/items/${lemons}`, { archived: false })).body.archived).toBe(false);

    const empty = (await Mgr().post(`${M}/orders`, { supplierId: drinks })).body;
    expect((await Mgr().post(`${M}/orders/${empty.id}/send`, {})).body.title).toMatch(/at least one item/);
    expect((await Mgr().del(`${M}/orders/${empty.id}`)).status).toBe(204);
    expect((await Mgr().get(`${M}/orders/${empty.id}`)).status).toBe(404);
  });

  it("another company sees none of it", async () => {
    expect((await B().get(`${M}/items`)).status).toBe(403);
    await B().post("/modules/inventory/enable", {});
    expect((await B().get(`${M}/items`)).body.data).toEqual([]);
    expect((await B().get(`${M}/orders`)).body).toEqual([]);
    expect((await B().get(`${M}/movements`)).body.total).toBe(0);
    expect((await B().get(`${M}/items/${milk}`)).status).toBe(404);
    expect((await B().post(`${M}/items/${milk}/adjust`, { reason: "usage", quantity: 1 })).status).toBe(404);
    expect((await B().post(`${M}/items`, { name: "Bread", unit: "unit", minStock: 0, unitCostCents: 0, supplierId: fresh })).status).toBe(400); // A's company
  });

  it("turning it off keeps the data", async () => {
    await Own().post("/modules/inventory/disable", {});
    expect((await Vic().get(`${M}/items`)).status).toBe(403);
    await Own().post("/modules/inventory/enable", {});
    expect((await Vic().get(`${M}/items`)).body.data).toHaveLength(4);
  });
});
