import { afterAll, beforeAll, describe, expect, it } from "vitest";
import expensesModule from "@office/module-expenses";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let owner: string, mia: string, max: string, lee: string, bob: string, tA: string, tB: string;
const M = "/m/expenses";
const O = () => h.client(owner, tA);
const Mgr = () => h.client(mia, tA);   // manager
const Max = () => h.client(max, tA);   // member (employee)
const Lee = () => h.client(lee, tA);   // another employee
const B = () => h.client(bob, tB);     // another company

// Smallest valid PNG (1x1), as base64.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const receipt = (over: Record<string, unknown> = {}) => ({
  vendor: "Mercado Central", docDate: "2026-03-14", category: "Food & drink supplies", taxCents: 141, totalCents: 1550,
  lines: [{ description: "Limes", quantity: 2, amountCents: 500 }, { description: "Ice", quantity: 1, amountCents: 1050 }],
  ...over,
});

beforeAll(async () => {
  h = await setup([expensesModule]);
  [owner, mia, max, lee, bob] = await Promise.all(["olga", "mia", "max", "lee", "bob"].map((n) => h.token(n))) as [string, string, string, string, string];
  tA = (await h.client(owner).post("/tenants", { slug: "bar", name: "Bar" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "shop", name: "Shop" })).body.id;
  for (const [t, role] of [[mia, "manager"], [max, "member"], [lee, "member"]] as const) {
    const me = (await h.client(t).get("/me")).body;
    await O().post("/members", { email: me.email, roles: [role] });
  }
});
afterAll(async () => { await h.teardown(); });

describe("expenses module", () => {
  let id: string;
  let fileId: string;

  it("is off until added; then gives employees and managers the right access", async () => {
    expect((await Max().get(`${M}/expenses`)).status).toBe(403);
    expect((await O().post("/modules/expenses/enable", {})).status).toBe(200);
    const cfg = (await Max().get(`${M}/config`)).body;
    expect(cfg).toMatchObject({ currency: "EUR", canSubmit: true, canReview: false });
    expect(cfg.categories).toContain("Food & drink supplies");
    expect((await Mgr().get(`${M}/config`)).body.canReview).toBe(true);
  });

  it("validates input with clear messages", async () => {
    let r = await Max().post(`${M}/expenses`, receipt({ vendor: "" }));
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("Enter the vendor");
    r = await Max().post(`${M}/expenses`, receipt({ taxCents: 5000 }));
    expect(r.status).toBe(400);
    expect(r.body.title).toBe("Tax cannot be more than the total");
    r = await Max().post(`${M}/expenses`, receipt({ lines: [{ description: "Limes", amountCents: 100 }] }));
    expect(r.status).toBe(400);
    expect(r.body.title).toMatch(/line items add up to 1.00/);
    r = await Max().post(`${M}/expenses`, receipt({ docDate: "14/03/2026" }));
    expect(r.status).toBe(400);
  });

  it("uploads a receipt photo and checks the file really is one", async () => {
    let r = await Max().post(`${M}/files`, { name: "fake.png", contentType: "image/png", data: Buffer.from("not an image").toString("base64") });
    expect(r.status).toBe(400);
    expect(r.body.title).toMatch(/does not match/);
    r = await Max().post(`${M}/files`, { name: "receipt.png", contentType: "image/png", data: PNG });
    expect(r.status).toBe(201);
    fileId = r.body.id;
  });

  it("creates a draft with lines (tax-inclusive lines are fine) and the photo", async () => {
    const r = await Max().post(`${M}/expenses`, receipt({ fileId, ocrText: "MERCADO CENTRAL\nTOTAL 15,50" }));
    expect(r.status).toBe(201);
    id = r.body.id;
    expect(r.body).toMatchObject({ status: "draft", subtotalCents: 1409, taxCents: 141, totalCents: 1550, currency: "EUR" });
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.file).toMatchObject({ id: fileId, contentType: "image/png" });
    expect(r.body.can).toMatchObject({ edit: true, submit: true, approve: false });
    expect((await Max().get(`${M}/files/${fileId}`)).body.data).toBe(PNG);
  });

  it("employees only see their own expenses", async () => {
    expect((await Lee().get(`${M}/expenses`)).body.data).toEqual([]);
    expect((await Lee().get(`${M}/expenses/${id}`)).status).toBe(404);
    expect((await Lee().get(`${M}/files/${fileId}`)).status).toBe(404);
    expect((await Lee().patch(`${M}/expenses/${id}`, { vendor: "x" })).status).toBe(404);
    expect((await Max().get(`${M}/expenses`)).body.data.map((e: { id: string }) => e.id)).toEqual([id]);
  });

  it("submit → reject with a comment → fix → resubmit → approve → paid", async () => {
    expect((await Max().post(`${M}/expenses/${id}/approve`, {})).status).toBe(403); // employees can't approve
    expect((await Mgr().post(`${M}/expenses/${id}/submit`, {})).status).toBe(403); // only the payer submits
    let r = await Max().post(`${M}/expenses/${id}/submit`, {});
    expect(r.body.status).toBe("submitted");
    expect((await Max().patch(`${M}/expenses/${id}`, { vendor: "x" })).status).toBe(403); // locked while waiting

    const waiting = (await Mgr().get(`${M}/expenses`)).body;
    expect(waiting.data.map((e: { id: string; employeeName: string }) => [e.id, e.employeeName])).toEqual([[id, expect.any(String)]]);
    expect((await Mgr().get(`${M}/expenses?status=submitted`)).body.total).toBe(1);

    expect((await Mgr().post(`${M}/expenses/${id}/reject`, {})).status).toBe(400); // reason required
    r = await Mgr().post(`${M}/expenses/${id}/reject`, { comment: "Please split the ice into its own expense" });
    expect(r.body).toMatchObject({ status: "rejected", decisionComment: "Please split the ice into its own expense" });

    r = await Max().patch(`${M}/expenses/${id}`, { totalCents: 641, taxCents: 141, lines: [{ description: "Limes", quantity: 2, amountCents: 500 }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ subtotalCents: 500, totalCents: 641 });
    expect((await Max().post(`${M}/expenses/${id}/submit`, {})).body.status).toBe("submitted");

    expect((await Mgr().post(`${M}/expenses/${id}/pay`, {})).status).toBe(409); // must be approved first
    r = await Mgr().post(`${M}/expenses/${id}/approve`, { comment: "Thanks" });
    expect(r.body.status).toBe("approved");
    expect((await Mgr().post(`${M}/expenses/${id}/approve`, {})).status).toBe(409); // not twice
    expect((await Max().patch(`${M}/expenses/${id}`, { vendor: "x" })).status).toBe(409);
    expect((await Max().del(`${M}/expenses/${id}`)).status).toBe(409);
    r = await Mgr().post(`${M}/expenses/${id}/pay`, {});
    expect(r.body.status).toBe("paid");
    expect(r.body.paidAt).toBeTruthy();
    expect(r.body.history.map((x: { action: string }) => x.action))
      .toEqual(["created", "submitted", "rejected", "edited", "submitted", "approved", "paid"]);

    const types = (await h.events(tA)).map((e) => e.type).filter((t) => t.startsWith("expenses."));
    expect(types).toEqual(["expenses.expense.created", "expenses.expense.submitted", "expenses.expense.rejected",
      "expenses.expense.submitted", "expenses.expense.approved", "expenses.expense.paid"]);
  });

  it("filters by date, vendor, status and employee; exports CSV", async () => {
    await Lee().post(`${M}/expenses`, receipt({ vendor: "=HYPERLINK(\"x\")", docDate: "2026-04-02", taxCents: 0, totalCents: 990, lines: [] }));
    await Max().post(`${M}/expenses`, receipt({ vendor: "Gas Station", docDate: "2026-02-01", category: "Fuel", taxCents: 0, totalCents: 4000, lines: [] }));
    const people = (await Mgr().get(`${M}/people`)).body as { userId: string; name: string }[];
    expect((await Max().get(`${M}/people`)).status).toBe(403);
    const leeId = (await Lee().get(`${M}/config`)).body.me;
    expect(people.map((p) => p.userId)).toContain(leeId);

    const q = async (s: string) => (await Mgr().get(`${M}/expenses?${s}`)).body as { total: number; data: { vendor: string }[]; totals: { cents: number }[] };
    expect((await q("from=2026-03-01&to=2026-03-31")).data.map((e) => e.vendor)).toEqual(["Mercado Central"]);
    expect((await q("vendor=gas")).data.map((e) => e.vendor)).toEqual(["Gas Station"]);
    expect((await q("status=paid")).total).toBe(1);
    expect((await q(`employeeId=${leeId}`)).total).toBe(1);
    expect((await q("category=Fuel")).totals[0]!.cents).toBe(4000);
    expect((await q("from=2027-01-01")).total).toBe(0);
    expect((await Mgr().get(`${M}/expenses?from=nope`)).status).toBe(400);

    const csv = (await Mgr().get(`${M}/export?from=2026-01-01`)).body as { csv: string; rows: number; filename: string };
    expect(csv.rows).toBe(3);
    expect(csv.filename).toMatch(/^expenses-\d{4}-\d{2}-\d{2}\.csv$/);
    const rows = csv.csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(rows[0]).toBe("Date,Vendor,Type,Invoice number,Category,Employee,Status,Currency,Before tax,Tax,Total,Submitted,Decided by,Decided,Comment,Paid,Description");
    expect(rows.some((r) => r.startsWith("2026-03-14,Mercado Central,Receipt,,Food & drink supplies,") && r.includes(",Paid,EUR,5.00,1.41,6.41,"))).toBe(true);
    expect(rows.some((r) => r.includes(`"'=HYPERLINK(""x"")"`))).toBe(true); // formulas are neutralised
    // Employees export only their own.
    expect((await Lee().get(`${M}/export`)).body.rows).toBe(1);
  });

  it("dashboard summary", async () => {
    const s = (await Mgr().get(`${M}/summary`)).body;
    expect(s.toReview.count).toBe(0);
    const mine = (await Max().get(`${M}/summary`)).body;
    expect(mine.mine.draft.count).toBe(1);
    expect(mine.toReview).toBeUndefined();
  });

  it("another company never sees this company's expenses or files", async () => {
    expect((await B().get(`${M}/expenses`)).status).toBe(403); // not added there
    await B().post("/modules/expenses/enable", {});
    expect((await B().get(`${M}/expenses`)).body.data).toEqual([]);
    expect((await B().get(`${M}/expenses/${id}`)).status).toBe(404);
    expect((await B().get(`${M}/files/${fileId}`)).status).toBe(404);
    expect((await B().post(`${M}/expenses/${id}/approve`, {})).status).toBe(404);
    expect((await B().post(`${M}/expenses`, receipt({ fileId, lines: [] , taxCents: 0 }))).status).toBe(400); // A's file is invisible
    expect((await B().get(`${M}/export`)).body.rows).toBe(0);
  });

  it("removing the feature keeps the data", async () => {
    await O().post("/modules/expenses/disable", {});
    expect((await Mgr().get(`${M}/expenses`)).status).toBe(403);
    await O().post("/modules/expenses/enable", {});
    expect((await Mgr().get(`${M}/expenses/${id}`)).body.status).toBe("paid");
  });
});
