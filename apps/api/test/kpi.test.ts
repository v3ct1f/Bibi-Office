import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runDueJobs } from "@office/platform";
import { defineModule, metric } from "@office/sdk";
import { uuidv7 } from "@office/db";
import crm from "@office/module-crm";
import expenses from "@office/module-expenses";
import invoicing from "@office/module-invoicing";
import kpi from "@office/module-kpi";
import support from "@office/module-support";
import { startMailServers } from "../../../modules/support/tests/mail-servers.ts";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let relay: postgres.Sql;
let mail: Awaited<ReturnType<typeof startMailServers>>;
let owner: string, mia: string, max: string, vic: string, bob: string, tA: string, tB: string;
let ownerId: string, maxId: string;
const M = "/m/kpi";
const Own = () => h.client(owner, tA);
const Mgr = () => h.client(mia, tA);
const Max = () => h.client(max, tA);
const Vic = () => h.client(vic, tA);
const B = () => h.client(bob, tB);
const values = (board: string, q: Record<string, string>) => `${M}/boards/${board}/values?${new URLSearchParams(q)}`;
const tile = (body: { tiles: { metricKey: string }[] }, key: string) => body.tiles.find((t) => t.metricKey === key) as Record<string, any>;
const APP = "https://office.example/t/bakery/m/kpi/kpi";

/** Seeds October and September 2025 in Invoicing, Expenses, CRM and Support (straight into their tables). */
async function seed() {
  await h.asOwner(tA, async (tx) => {
    const inv = async (status: string, issue: string, subtotal: number, total: number, opts: { currency?: string; voidedAt?: string } = {}) => {
      const id = uuidv7();
      await tx`insert into invoicing_invoices (id, tenant_id, number, status, currency, issue_date, due_date, subtotal_cents, tax_cents, total_cents, voided_at)
        values (${id}, ${tA}, ${status === "draft" ? null : `T-${id.slice(-8)}`}, ${status}, ${opts.currency ?? "EUR"}, ${issue}, ${issue}::date + 14,
          ${subtotal}, ${total - subtotal}, ${total}, ${opts.voidedAt ?? null})`;
      return id;
    };
    const paid = await inv("paid", "2025-10-03", 100_000, 121_000);     // €1,000 + VAT
    const part = await inv("sent", "2025-10-20", 50_000, 60_500);       // €500 + VAT, half paid in November
    await inv("draft", "2025-10-21", 999_900, 999_900);                 // drafts don't count
    await inv("void", "2025-10-22", 70_000, 70_000, { voidedAt: "2025-10-25T10:00:00Z" });
    await inv("sent", "2025-10-23", 30_000, 30_000, { currency: "USD" }); // other currency: left out
    const sep = await inv("paid", "2025-09-10", 80_000, 96_800);        // September: €800
    const pay = (invoice: string, cents: number, on: string) =>
      tx`insert into invoicing_payments (id, tenant_id, invoice_id, amount_cents, paid_on) values (${uuidv7()}, ${tA}, ${invoice}, ${cents}, ${on})`;
    await pay(sep, 96_800, "2025-09-25");
    await pay(paid, 121_000, "2025-10-10");
    await pay(part, 30_250, "2025-11-05");

    const exp = (status: string, date: string, subtotal: number, total: number) =>
      tx`insert into expenses_expenses (id, tenant_id, status, employee_id, vendor, doc_date, currency, subtotal_cents, tax_cents, total_cents)
        values (${uuidv7()}, ${tA}, ${status}, ${ownerId}, 'Flour Co', ${date}, 'EUR', ${subtotal}, ${total - subtotal}, ${total})`;
    await exp("approved", "2025-10-05", 30_000, 36_300);
    await exp("paid", "2025-10-12", 10_000, 12_100);
    await exp("submitted", "2025-10-13", 99_900, 99_900); // not approved: left out
    await exp("approved", "2025-09-05", 20_000, 24_200);

    const [stage] = await tx<{ id: string; pipeline_id: string }[]>`select id, pipeline_id from crm_stages order by position limit 1`;
    const deal = (title: string, cents: number, status: string, created: string, closed: string | null) =>
      tx`insert into crm_deals (id, tenant_id, pipeline_id, stage_id, title, value_cents, currency, status, created_at, closed_at)
        values (${uuidv7()}, ${tA}, ${stage!.pipeline_id}, ${stage!.id}, ${title}, ${cents}, 'EUR', ${status}, ${created}, ${closed})`;
    await deal("Café chain", 400_000, "won", "2025-09-01T09:00:00Z", "2025-10-15T09:00:00Z");
    await deal("Hotel", 100_000, "lost", "2025-09-02T09:00:00Z", "2025-10-16T09:00:00Z");
    await deal("School", 250_000, "won", "2025-10-02T09:00:00Z", "2025-10-30T09:00:00Z");
    await deal("Office", 300_000, "open", "2025-10-03T09:00:00Z", null);

    const ticket = (seq: number, created: string, firstReply: string | null, due: string | null, solved: string | null) =>
      tx`insert into support_tickets (id, tenant_id, seq, subject, status, created_at, first_response_at, first_response_due, solved_at)
        values (${uuidv7()}, ${tA}, ${seq}, 'Help', ${solved ? "solved" : "open"}, ${created}, ${firstReply}, ${due}, ${solved})`;
    await ticket(1, "2025-10-01T08:00:00Z", "2025-10-01T09:00:00Z", "2025-10-01T16:00:00Z", "2025-10-02T08:00:00Z"); // 60 min
    await ticket(2, "2025-10-05T08:00:00Z", "2025-10-05T11:00:00Z", "2025-10-05T10:00:00Z", null);                     // 180 min, late
    await ticket(3, "2025-09-20T08:00:00Z", null, null, "2025-10-10T08:00:00Z");
  });
}

beforeAll(async () => {
  h = await setup([invoicing, crm, expenses, support, kpi]);
  relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  mail = await startMailServers();
  [owner, mia, max, vic, bob] = await Promise.all(["olga", "mia", "max", "vic", "bob"].map((n) => h.token(n))) as [string, string, string, string, string];
  tA = (await h.client(owner).post("/tenants", { slug: "bakery", name: "Bakery" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "other", name: "Other" })).body.id;
  for (const [t, role] of [[mia, "manager"], [max, "member"], [vic, "viewer"]] as const) {
    const me = (await h.client(t).get("/me")).body;
    await Own().post("/members", { email: me.email, roles: [role] });
  }
  [ownerId, maxId] = await Promise.all([owner, max].map(async (t) => (await h.client(t).get("/me")).body.userId)) as [string, string];
});
afterAll(async () => { await relay.end(); await mail.stop(); await h.teardown(); });

describe("kpi module", () => {
  let board: string;

  it("lists only numbers from features that are on and that the reader may see", async () => {
    expect((await Max().get(`${M}/config`)).status).toBe(403);
    await Own().post("/modules/kpi/enable", {});
    let keys = (await Own().get(`${M}/config`)).body.catalogue.map((m: { key: string }) => m.key);
    expect(keys).toEqual(["core.contacts_new", "core.tasks_overdue", "core.members"]);

    for (const k of ["invoicing", "crm", "expenses", "support"]) await Own().post(`/modules/${k}/enable`, {});
    const cfg = (await Own().get(`${M}/config`)).body;
    keys = cfg.catalogue.map((m: { key: string }) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["invoicing.revenue", "invoicing.unpaid", "expenses.spent", "kpi.profit", "crm.win_rate", "support.first_response"]));
    expect(cfg.catalogue.find((m: { key: string }) => m.key === "invoicing.revenue")).toMatchObject({
      label: "Revenue", group: "money", unit: "money", kind: "total", better: "up", link: "/m/invoicing/invoices", source: "module",
    });
    expect(cfg).toMatchObject({ canManage: true, canWriteValues: true, timeZone: "UTC", mail: { ready: false } });

    // A member: no invoicing or expense review, so no money numbers and no profit
    const mine = (await Max().get(`${M}/config`)).body;
    const mk = mine.catalogue.map((m: { key: string }) => m.key);
    expect(mk).toEqual(expect.arrayContaining(["crm.won_value", "support.new_tickets", "core.contacts_new"]));
    expect(mk).not.toContain("invoicing.revenue");
    expect(mk).not.toContain("expenses.spent");
    expect(mk).not.toContain("kpi.profit");
    expect(mine).toMatchObject({ canManage: false, canWriteValues: false, people: [] });
  });

  it("works out each number live for any month, with comparisons and a trend", async () => {
    await seed();
    expect((await Max().post(`${M}/boards`, { name: "Mine" })).status).toBe(403);
    const created = await Mgr().post(`${M}/boards`, { name: "Monthly review", suggested: true });
    expect(created.status).toBe(201);
    board = created.body.id;
    expect(created.body.tiles.map((t: { metricKey: string }) => t.metricKey).slice(0, 5))
      .toEqual(["invoicing.revenue", "invoicing.payments_received", "invoicing.unpaid", "expenses.spent", "kpi.profit"]);

    const tiles = [
      "invoicing.revenue", "invoicing.invoiced", "invoicing.payments_received", "invoicing.unpaid", "invoicing.overdue", "expenses.spent",
      "expenses.spent_net", "kpi.profit", "crm.won_value", "crm.won_count", "crm.win_rate", "crm.pipeline_value", "crm.new_deals",
      "support.new_tickets", "support.solved", "support.first_response", "support.targets_missed", "support.open_tickets", "core.tasks_overdue",
    ].map((metricKey) => ({ metricKey, chart: "bar" }));
    expect((await Mgr().patch(`${M}/boards/${board}`, { tiles })).status).toBe(200);

    const r = await Own().get(values(board, { period: "month", date: "2025-10-15" }));
    expect(r.status).toBe(200);
    expect(r.body.period).toMatchObject({ kind: "month", from: "2025-10-01", to: "2025-11-01", label: "October 2025", finished: true, current: false });
    expect(r.body.previous).toBe("2025-09-01");
    const v = (k: string) => tile(r.body, k).value;
    expect(v("invoicing.revenue")).toBe(1500);            // €1,000 + €500, not drafts, void, USD or September
    expect(tile(r.body, "invoicing.revenue").currency).toBe("EUR");
    expect(v("invoicing.invoiced")).toBe(1815);
    expect(v("invoicing.payments_received")).toBe(1210);
    expect(v("invoicing.unpaid")).toBe(605);              // the half-paid invoice was still fully open on 31 October
    expect(v("invoicing.overdue")).toBe(0);               // due 3 November
    expect(v("expenses.spent")).toBe(484);
    expect(v("expenses.spent_net")).toBe(400);
    expect(v("kpi.profit")).toBe(1100);                   // 1,500 − 400
    expect(v("crm.won_value")).toBe(6500);
    expect(v("crm.won_count")).toBe(2);
    expect(v("crm.win_rate")).toBeCloseTo(66.67, 1);
    expect(v("crm.pipeline_value")).toBe(3000);
    expect(v("crm.new_deals")).toBe(2);
    expect(v("support.new_tickets")).toBe(2);
    expect(v("support.solved")).toBe(2);
    expect(v("support.first_response")).toBe(120);        // (60 + 180) / 2
    expect(v("support.targets_missed")).toBe(1);
    expect(v("support.open_tickets")).toBe(1);
    expect(v("core.tasks_overdue")).toBeNull();           // a live count can't be worked out for a past month

    // Compared with September, and better or worse depending on the number
    expect(tile(r.body, "invoicing.revenue").compare).toMatchObject({ value: 800, label: "September 2025", change: 87.5, good: true });
    expect(tile(r.body, "expenses.spent").compare).toMatchObject({ value: 242, change: 100, good: false });
    expect(tile(r.body, "crm.pipeline_value").compare.value).toBe(5000); // both September deals were open at the end of September

    // The trend: 12 months ending in October
    const s = tile(r.body, "invoicing.revenue").series;
    expect(s).toHaveLength(12);
    expect(s.at(-1)).toEqual({ from: "2025-10-01", label: "Oct", value: 1500 });
    expect(s.at(-2)).toEqual({ from: "2025-09-01", label: "Sep", value: 800 });

    // Other periods, and comparing with last year
    const q = (await Own().get(values(board, { period: "quarter", date: "2025-10-15", compare: "last_year", chart: "no" }))).body;
    expect(q.period).toMatchObject({ from: "2025-10-01", to: "2026-01-01", label: "Q4 2025" });
    expect(tile(q, "invoicing.revenue")).toMatchObject({ value: 1500, compare: { value: 0, label: "Q4 2024", change: null }, series: [] });
    const w = (await Own().get(values(board, { period: "week", date: "2025-10-22", chart: "no" }))).body;
    expect(w.period).toMatchObject({ from: "2025-10-20", to: "2025-10-27", label: "Week of 20 Oct 2025" });
    expect(tile(w, "invoicing.revenue").value).toBe(500);
    expect((await Own().get(values(board, { date: "2025-13-01" }))).status).toBe(400);
  });

  it("shows each person only the numbers they may see", async () => {
    const r = (await Max().get(values(board, { period: "month", date: "2025-10-15", chart: "no" }))).body;
    expect(tile(r, "invoicing.revenue")).toMatchObject({ label: "Revenue", metric: null, unavailable: expect.stringMatching(/Not available/) });
    expect(tile(r, "kpi.profit").metric).toBeNull();
    expect(tile(r, "crm.won_value").value).toBe(6500);
    expect((await Vic().get(values(board, { period: "month", date: "2025-10-15", chart: "no" }))).status).toBe(200);
    expect((await Max().patch(`${M}/boards/${board}`, { name: "Hacked" })).status).toBe(403);
    expect((await Max().get(`${M}/boards/${board}`)).body.digest).toBeNull();
  });

  it("targets say whether a month met its goal, and how a running month is doing", async () => {
    expect((await Max().put(`${M}/targets`, { metricKey: "crm.won_value", period: "month", value: 5000 })).status).toBe(403);
    expect((await Mgr().put(`${M}/targets`, { metricKey: "made.up", period: "month", value: 1 })).status).toBe(400);
    for (const [metricKey, value] of [["invoicing.revenue", 2000], ["crm.won_value", 5000], ["expenses.spent", 400]] as const) {
      const t = await Mgr().put(`${M}/targets`, { metricKey, period: "month", value });
      expect(t.status, JSON.stringify(t.body)).toBe(200);
    }
    const r = (await Own().get(values(board, { period: "month", date: "2025-10-15", chart: "no" }))).body;
    expect(tile(r, "invoicing.revenue").target).toEqual({ value: 2000, progress: 75, pace: null, status: "missed" });
    expect(tile(r, "crm.won_value").target).toMatchObject({ value: 5000, progress: 130, status: "met" });
    expect(tile(r, "expenses.spent").target).toMatchObject({ value: 400, status: "missed" }); // a budget: 484 is over
    // Quarter view has no quarterly target
    expect(tile((await Own().get(values(board, { period: "quarter", date: "2025-10-15", chart: "no" }))).body, "invoicing.revenue").target).toBeNull();

    // This month: the target is spread over the days so far
    const now = (await Own().get(values(board, { period: "month", chart: "no" }))).body;
    expect(now.period.current).toBe(true);
    const t = tile(now, "invoicing.revenue").target;
    expect(t.pace).toBeCloseTo(2000 * now.period.daysElapsed / now.period.days, 1);
    expect(t.status).toBe("behind");
    expect((await Mgr().put(`${M}/targets`, { metricKey: "crm.won_value", period: "month", value: null })).status).toBe(200);
    expect((await Own().get(`${M}/targets`)).body).toHaveLength(2);
  });

  it("numbers typed in by hand add up per period or keep their latest value", async () => {
    expect((await Max().post(`${M}/manual`, { name: "Footfall", unit: "count", kind: "total", better: "up" })).status).toBe(403);
    expect((await Mgr().post(`${M}/manual`, { name: "Ad spend", unit: "money", kind: "total", better: "down" })).status).toBe(400); // no currency
    const foot = (await Mgr().post(`${M}/manual`, { name: "Footfall", description: "People through the door", unit: "count", kind: "total", better: "up" })).body;
    const fans = (await Mgr().post(`${M}/manual`, { name: "Instagram followers", unit: "count", kind: "snapshot", better: "up" })).body;
    for (const [id, date, value] of [[foot.id, "2025-10-01", 120], [foot.id, "2025-10-02", 80], [foot.id, "2025-09-30", 50],
      [fans.id, "2025-09-15", 900], [fans.id, "2025-10-20", 1000], [fans.id, "2025-11-02", 1100]] as const) {
      expect((await Mgr().put(`${M}/manual/${id}/values`, { date, value })).status).toBe(200);
    }
    // Typing the same day again replaces it; null removes it
    await Mgr().put(`${M}/manual/${foot.id}/values`, { date: "2025-10-02", value: 100, note: "Market day" });
    expect((await Max().put(`${M}/manual/${foot.id}/values`, { date: "2025-10-03", value: 1 })).status).toBe(403);
    const one = (await Max().get(`${M}/manual/${foot.id}`)).body;
    expect(one.values).toEqual([{ date: "2025-10-02", value: 100, note: "Market day" }, { date: "2025-10-01", value: 120, note: null }, { date: "2025-09-30", value: 50, note: null }]);
    expect((await Max().get(`${M}/manual`)).body.find((m: { id: string }) => m.id === fans.id)).toMatchObject({ lastDate: "2025-11-02", lastValue: 1100, valueCount: 3 });

    const b = (await Mgr().get(`${M}/boards/${board}`)).body;
    await Mgr().patch(`${M}/boards/${board}`, { tiles: [...b.tiles, { metricKey: foot.key, chart: "line" }, { metricKey: fans.key, label: "Followers", chart: "none" }] });
    const r = (await Max().get(values(board, { period: "month", date: "2025-10-15", chart: "no" }))).body;
    expect(tile(r, foot.key)).toMatchObject({ label: "Footfall", value: 220, compare: { value: 50 } });
    expect(tile(r, fans.key)).toMatchObject({ label: "Followers", value: 1000, compare: { value: 900 } });

    // Deleting it removes its tiles too
    expect((await Mgr().del(`${M}/manual/${fans.id}`)).status).toBe(204);
    expect((await Mgr().get(`${M}/boards/${board}`)).body.tiles.some((t: { metricKey: string }) => t.metricKey === fans.key)).toBe(false);
  });

  it("emails each person on the list their own numbers, now and every week", async () => {
    expect((await Mgr().post(`${M}/boards/${board}/email`, {})).status).toBe(409); // email not set up
    const s = mail.settings;
    await Own().patch("/modules/kpi/settings", { fromAddress: s.address, fromName: "Bakery Sol", smtpHost: s.smtpHost, smtpPort: s.smtpPort, smtpSecurity: "none", smtpUser: s.smtpUser, smtpPassword: s.smtpPassword });
    expect((await Mgr().post(`${M}/email/test`, {})).status).toBe(200);
    await mail.waitForSent(1);
    mail.sent.length = 0;

    expect((await Mgr().patch(`${M}/boards/${board}`, { digest: { enabled: true, weekday: 1, hour: 8, recipients: [] } })).status).toBe(400);
    expect((await Mgr().patch(`${M}/boards/${board}`, { digest: { enabled: true, weekday: 1, hour: 8, recipients: [uuidv7()] } })).status).toBe(400);
    const p = await Mgr().patch(`${M}/boards/${board}`, { digest: { enabled: true, weekday: 1, hour: 8, recipients: [ownerId, maxId], appUrl: APP } });
    expect(p.status).toBe(200);
    expect(p.body.digest.recipients.map((r: { userId: string }) => r.userId)).toEqual([ownerId, maxId]);

    const sent = await Mgr().post(`${M}/boards/${board}/email`, {});
    expect(sent.body).toMatchObject({ sent: expect.arrayContaining([expect.any(String)]), skipped: [], failed: [] });
    expect(sent.body.sent).toHaveLength(2);
    const got = await mail.waitForSent(2);
    const forOwner = got.find((g) => g.to.includes("olga@example.com"))!.mail;
    const forMax = got.find((g) => g.to.includes("max@example.com"))!.mail;
    expect(forOwner.subject).toMatch(/^Monthly review: /);
    expect(forOwner.text).toMatch(/Revenue: /);
    expect(forOwner.text).toContain(`${APP}?board=${board}`);
    expect(forMax.text).not.toContain("Revenue");     // left out: Max can't see invoices
    expect(forMax.text).not.toContain("Profit");
    expect(forMax.text).toMatch(/Deals won \(value\): /);

    // The job sends once on the chosen day and hour, not again the same day
    mail.sent.length = 0;
    const weekday = ((new Date().getUTCDay() + 6) % 7) + 1;
    await Mgr().patch(`${M}/boards/${board}`, { digest: { enabled: true, weekday, hour: 0, recipients: [maxId] } });
    await h.asOwner(tA, (tx) => tx`update kpi_boards set digest_last_sent_at = null`);
    const deps = { db: h.db, registry: h.registry, secrets: h.secrets };
    await relay`update module_job_state set next_run_at = now()`;
    await runDueJobs(relay, deps);
    await mail.waitForSent(1);
    await relay`update module_job_state set next_run_at = now()`;
    await runDueJobs(relay, deps);
    await new Promise((r) => setTimeout(r, 200));
    expect(mail.sent).toHaveLength(1);
    expect((await Mgr().get(`${M}/boards/${board}`)).body.digest).toMatchObject({ lastSentAt: expect.any(String), lastError: null });
  });

  it("keeps companies apart, and boards can be removed", async () => {
    expect((await B().get(`${M}/boards/${board}`)).status).toBe(403); // module off for B
    await h.client(bob, tB).post("/modules/kpi/enable", {});
    expect((await B().get(`${M}/boards/${board}`)).status).toBe(404);
    expect((await B().get(values(board, {}))).status).toBe(404);
    expect((await B().get(`${M}/boards`)).body).toEqual([]);
    expect((await Own().get(`${M}/boards`)).body).toEqual([expect.objectContaining({ id: board, name: "Monthly review" })]);
    expect((await Mgr().del(`${M}/boards/${board}`)).status).toBe(204);
    expect((await Own().get(`${M}/boards`)).body).toEqual([]);
  });

  it("checks metric definitions when a module loads", () => {
    const base = { key: "shop", name: "Shop", version: "1.0.0", office: "^1.0", permissions: { declares: [{ key: "shop:a.read", label: "Read" }] } };
    const m = (permission: string) => metric({ label: "x", description: "x", group: "other", unit: "count", kind: "total", better: "up", permission, compute: async () => 1 });
    expect(() => defineModule({ manifest: base, metrics: { "shop.sales": m("shop:a.read") } })).not.toThrow();
    expect(() => defineModule({ manifest: base, metrics: { "other.sales": m("shop:a.read") } })).toThrow(/must look like "shop.<name>"/);
    expect(() => defineModule({ manifest: base, metrics: { "shop.sales": m("shop:b.read") } })).toThrow(/undeclared permission/);
  });
});
