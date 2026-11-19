import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { defineModule, metric, moduleErrors, scalar } from "@office/sdk";
import { bucketStarts, metricRange, previousRange } from "@office/platform";
import { setup } from "../../../apps/api/test/harness.ts";
import crm from "../../crm/src/index.ts";
import support from "../../support/src/index.ts";
import kpi from "../src/index.ts";

// A fixture module: one good metric with a sparse series, one that hits an SQL error, one that throws a module error.
const flaky = defineModule({
  manifest: {
    key: "flaky", name: "Flaky", version: "1.0.0", office: "^1.0", description: "test",
    permissions: { declares: [{ key: "flaky:x.read", label: "x", defaultRoles: ["member"] }], requires: [] },
    entities: [], events: { emits: [], subscribes: [] }, workflow: { triggers: [], actions: [] }, ui: { slots: [] },
    settings: { type: "object", properties: {} }, api: { basePath: "/flaky" }, lifecycle: [],
  },
  metrics: {
    "flaky.ok": metric({ label: "OK", permission: "flaky:x.read", unit: "count", kind: "flow",
      compute: async (_c, r) => ({ value: r.fromDate === "2026-10-01" ? 7 : 3, series: [{ t: "2026-10-03", v: 7 }] }) }),
    "flaky.boom": metric({ label: "Boom", permission: "flaky:x.read", unit: "count", kind: "stock",
      compute: async (ctx) => ({ value: await scalar(ctx, sql`select count(*) as v from no_such_table`) }) }),
    "flaky.nope": metric({ label: "Nope", permission: "flaky:x.read", unit: "count", kind: "stock",
      compute: async () => { throw moduleErrors.unprocessable("Set a goal first"); } }),
  },
});

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, dave: string, vera: string, bob: string, tA: string, tB: string;
const c = (t: string) => h.client(t, tA);
const OCT = "from=2026-10-01&to=2026-10-31";
const vals = async (t: string, keys: string, q = OCT) => (await c(t).get(`/metrics/values?keys=${keys}&${q}`));
const byKey = (body: { data: { key: string }[] }) => Object.fromEntries(body.data.map((r) => [r.key, r])) as Record<string, Record<string, unknown>>;

beforeAll(async () => {
  h = await setup([crm, support, kpi, flaky]);
  [alice, dave, vera, bob] = await Promise.all(["alice", "dave", "vera", "bob"].map((u) => h.token(u))) as [string, string, string, string];
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" })).body.id;
  for (const t of [dave, vera]) await h.client(t).get("/me");
  await c(alice).post("/members", { email: "dave@example.com", roles: ["member"] });
  await c(alice).post("/members", { email: "vera@example.com", roles: ["viewer"] });
  for (const m of ["crm", "support", "kpi", "flaky"]) expect((await c(alice).post(`/modules/${m}/enable`, {})).status).toBe(200);
  await h.client(bob, tB).post("/modules/kpi/enable", {});
  await h.client(bob, tB).post("/modules/crm/enable", {});
  await h.asOwner(tA, async (tx) => {
    const [st] = await tx`select id from crm_stages order by position limit 1`;
    const deal = (title: string, value: number, status: string, closed: string | null, currency = "EUR") =>
      tx`insert into crm_deals (id, tenant_id, title, value, currency, stage_id, status, closed_at) values (gen_random_uuid(), ${tA}, ${title}, ${value}, ${currency}, ${st!.id}, ${status}, ${closed})`;
    await deal("A", 100_00, "won", "2026-10-03T10:00:00Z");
    await deal("B", 250_00, "won", "2026-10-20T23:30:00Z");
    await deal("C", 999_00, "won", "2026-10-21T00:00:00Z", "USD");   // other currency: left out
    await deal("D", 50_00, "lost", "2026-10-25T09:00:00Z");
    await deal("E", 80_00, "won", "2026-09-15T12:00:00Z");           // previous period
    await deal("F", 400_00, "open", null);
    await deal("G", 600_00, "open", null);
    const ticket = (n: number, status: string, created: string, first: string | null) =>
      tx`insert into support_tickets (id, tenant_id, number, subject, status, channel, requester_email, created_at, first_response_at, solved_at)
         values (gen_random_uuid(), ${tA}, ${n}, 'Help', ${status}, 'email', 'x@example.org', ${created}, ${first}, ${status === "solved" ? created : null})`;
    await ticket(1, "solved", "2026-10-02T08:00:00Z", "2026-10-02T10:00:00Z");
    await ticket(2, "open", "2026-10-05T08:00:00Z", "2026-10-05T12:00:00Z");
    await ticket(3, "new", "2026-10-06T08:00:00Z", null);
  });
});
afterAll(() => h?.teardown());

describe("metric ranges", () => {
  it("picks buckets by length and builds the previous period", () => {
    const r = metricRange("2026-10-01", "2026-10-31");
    expect(r.bucket).toBe("day");
    expect(bucketStarts(r)).toHaveLength(31);
    expect(previousRange(r)).toMatchObject({ fromDate: "2026-08-31", toDate: "2026-09-30" });
    expect(metricRange("2026-01-01", "2026-06-30").bucket).toBe("week");
    expect(bucketStarts(metricRange("2026-01-01", "2026-06-30"))[0]).toBe("2025-12-29");   // Monday
    expect(bucketStarts(metricRange("2025-11-01", "2026-10-31"))).toHaveLength(12);
    expect(() => metricRange("2026-10-02", "2026-10-01")).toThrow(/on or after/);
    expect(() => metricRange("2020-01-01", "2026-10-01")).toThrow(/3 years/);
  });
});

describe("core metrics API", () => {
  it("lists metrics of enabled modules the caller may see", async () => {
    const keys = (await c(alice).get("/metrics")).body.data.map((m: { key: string }) => m.key);
    expect(keys).toEqual(expect.arrayContaining(["crm.won_value", "crm.pipeline", "crm.win_rate", "support.open_tickets", "flaky.ok"]));
    const member = (await c(dave).get("/metrics")).body.data.map((m: { key: string }) => m.key);
    expect(member).toContain("support.open_tickets");
    expect(member.some((k: string) => k.startsWith("crm."))).toBe(false);   // CRM deals are admin-only by default
    expect(keys.some((k: string) => k.startsWith("invoicing."))).toBe(false);   // not installed here
    expect((await c(vera).get("/metrics")).body.data).toEqual([]);            // viewer: no module read permissions
  });

  it("computes flow metrics with series, previous period and currency", async () => {
    const r = await vals(alice, "crm.won_value,crm.win_rate,crm.pipeline");
    expect(r.status).toBe(200);
    expect(r.body.range).toEqual({ from: "2026-10-01", to: "2026-10-31", bucket: "day" });
    expect(r.body.previous).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    const m = byKey(r.body);
    expect(m["crm.won_value"]).toMatchObject({ ok: true, value: 350_00, previous: 80_00, currency: "EUR", unit: "money", kind: "flow" });
    const s = m["crm.won_value"]!.series as { t: string; v: number }[];
    expect(s).toHaveLength(31);
    expect(s.find((p) => p.t === "2026-10-03")!.v).toBe(100_00);
    expect(s.find((p) => p.t === "2026-10-20")!.v).toBe(250_00);   // 23:30 UTC stays on the 20th
    expect(s.find((p) => p.t === "2026-10-21")!.v).toBe(0);        // USD deal not counted
    expect(m["crm.win_rate"]).toMatchObject({ value: 75, previous: 100, unit: "percent", series: null });   // a rate has no summed series
    expect(m["crm.pipeline"]).toMatchObject({ value: 1000_00, previous: null, series: null, kind: "stock" });
  });

  it("buckets by month and fills empty buckets", async () => {
    const s = byKey((await vals(alice, "crm.won_value", "from=2026-08-01&to=2026-10-31&bucket=month")).body)["crm.won_value"]!.series;
    expect(s).toEqual([{ t: "2026-08-01", v: 0 }, { t: "2026-09-01", v: 80_00 }, { t: "2026-10-01", v: 350_00 }]);
  });

  it("computes support metrics", async () => {
    const m = byKey((await vals(dave, "support.new_tickets,support.open_tickets,support.first_response")).body);
    expect(m["support.new_tickets"]).toMatchObject({ value: 3, previous: 0 });
    expect(m["support.open_tickets"]).toMatchObject({ value: 2, lowerIsBetter: true });
    expect(m["support.first_response"]).toMatchObject({ value: 3, unit: "hours" });   // median of 2 h and 4 h
  });

  it("isolates failures per metric and keeps the rest", async () => {
    const m = byKey((await vals(alice, "flaky.boom,flaky.ok,flaky.nope,crm.pipeline")).body);
    expect(m["flaky.boom"]).toMatchObject({ ok: false, error: "failed", message: "This metric couldn't be calculated" });
    expect(m["flaky.nope"]).toMatchObject({ ok: false, error: "failed", message: "Set a goal first" });
    expect(m["flaky.ok"]).toMatchObject({ ok: true, value: 7, previous: 3 });
    expect(m["crm.pipeline"]).toMatchObject({ ok: true, value: 1000_00 });
  });

  it("reports unknown, forbidden and disabled metrics as unavailable", async () => {
    let m = byKey((await vals(dave, "crm.pipeline,nope.thing")).body);
    expect(m["crm.pipeline"]).toMatchObject({ ok: false, error: "unavailable" });
    expect(m["nope.thing"]).toMatchObject({ ok: false, error: "unavailable", message: "Unknown metric" });
    await c(alice).post("/modules/flaky/disable", {});
    m = byKey((await vals(dave, "flaky.ok")).body);
    expect(m["flaky.ok"]).toMatchObject({ ok: false, message: "The module is turned off" });
    await c(alice).post("/modules/flaky/enable", {});
  });

  it("validates the query", async () => {
    expect((await c(dave).get(`/metrics/values?keys=crm.pipeline&from=2026-10-31&to=2026-10-01`)).status).toBe(400);
    expect((await c(dave).get(`/metrics/values?keys=DROP TABLE&${OCT}`)).status).toBe(400);
    expect((await c(dave).get(`/metrics/values?keys=crm.pipeline&from=2026-13-01&to=2026-10-01`)).status).toBe(400);
    expect((await c(dave).get(`/metrics/values?keys=${Array.from({ length: 31 }, (_, i) => `crm.m${i}`).join(",")}&${OCT}`)).status).toBe(400);
  });

  it("keeps tenants apart (RLS)", async () => {
    const m = byKey((await h.client(bob, tB).get(`/metrics/values?keys=crm.won_value,crm.pipeline&${OCT}`)).body);
    expect(m["crm.won_value"]).toMatchObject({ value: 0 });
    expect(m["crm.pipeline"]).toMatchObject({ value: 0 });
  });

  it("rejects badly named metrics at definition time", () => {
    expect(() => defineModule({
      manifest: { key: "bad", name: "Bad", version: "1.0.0", office: "^1.0", description: "x", permissions: { declares: [], requires: [] },
        entities: [], events: { emits: [], subscribes: [] }, workflow: { triggers: [], actions: [] }, ui: { slots: [] }, settings: { type: "object", properties: {} }, api: { basePath: "/bad" }, lifecycle: [] },
      metrics: { "other.x": metric({ label: "x", permission: "bad:x", unit: "count", kind: "stock", compute: async () => ({ value: 1 }) }) },
    })).toThrow(/must be named bad\.<name>.*undeclared permission/);
  });
});

describe("kpi dashboards", () => {
  it("seeds an Overview dashboard on enable", async () => {
    const r = (await c(dave).get("/m/kpi/dashboards")).body;
    expect(r.canManage).toBe(false);
    expect(r.data).toHaveLength(1);
    expect(r.data[0]).toMatchObject({ name: "Overview", position: 0 });
    expect(r.data[0].tiles.map((t: { metric: string }) => t.metric)).toContain("crm.pipeline");
    expect(r.data[0].tiles[0].id).toMatch(/^[\w-]{8}$/);
  });

  it("lets admins create, edit and delete dashboards", async () => {
    expect((await c(dave).post("/m/kpi/dashboards", { name: "Sales" })).status).toBe(403);
    const d = await c(alice).post("/m/kpi/dashboards", { name: "Sales", tiles: [{ metric: "crm.won_value", view: "line", target: 5000 }] });
    expect(d.status).toBe(201);
    expect(d.body).toMatchObject({ name: "Sales", position: 1, tiles: [{ metric: "crm.won_value", view: "line", target: 5000 }] });
    expect((await c(alice).post("/m/kpi/dashboards", { name: "Sales" })).status).toBe(409);
    const p = await c(alice).patch(`/m/kpi/dashboards/${d.body.id}`, { name: "Sales team", tiles: [{ id: d.body.tiles[0].id, metric: "crm.won_value", view: "bar", target: null }, { metric: "crm.win_rate" }] });
    expect(p.body).toMatchObject({ name: "Sales team", tiles: [{ id: d.body.tiles[0].id, view: "bar", target: null }, { metric: "crm.win_rate", view: "number" }] });
    expect((await c(dave).patch(`/m/kpi/dashboards/${d.body.id}`, { name: "x" })).status).toBe(403);
    expect((await c(alice).patch(`/m/kpi/dashboards/${d.body.id}`, { tiles: Array.from({ length: 25 }, () => ({ metric: "crm.pipeline" })) })).status).toBe(400);
    expect((await c(alice).patch(`/m/kpi/dashboards/${d.body.id}`, { tiles: [{ metric: "x" }] })).status).toBe(400);
    expect((await c(dave).get(`/m/kpi/dashboards/${d.body.id}`)).body.name).toBe("Sales team");
    expect((await c(alice).del(`/m/kpi/dashboards/${d.body.id}`)).status).toBe(204);
    expect((await c(dave).get(`/m/kpi/dashboards/${d.body.id}`)).status).toBe(404);
    expect((await c(vera).get("/m/kpi/dashboards")).status).toBe(403);
  });

  it("keeps dashboards per tenant", async () => {
    const mine = (await c(alice).get("/m/kpi/dashboards")).body.data[0].id;
    expect((await h.client(bob, tB).get(`/m/kpi/dashboards/${mine}`)).status).toBe(404);
    expect((await h.client(bob, tB).get("/m/kpi/dashboards")).body.data).toHaveLength(1);
  });
});
