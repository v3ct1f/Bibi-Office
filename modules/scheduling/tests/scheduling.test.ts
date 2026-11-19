import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchEvent, InlineRunner, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import { setup } from "../../../apps/api/test/harness.ts";
import scheduling from "../src/index.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, dave: string, bob: string, tA: string, exec: ExecDeps, carolId: string, daveId: string, svcId: string;
const A = () => h.client(alice, tA);
const Cm = () => h.client(carol, tA);
const base = "/m/scheduling";
const TZ = "Europe/Berlin";

/** Next Monday at least 3 days away, as YYYY-MM-DD. */
const monday = (() => { const d = new Date(Date.now() + 3 * 86_400_000); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })();
const berlinTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
/** Instant for HH:MM Berlin time on `monday`. */
let at: (hhmm: string) => string;

const pub = async (method: "GET" | "POST", path: string, body?: unknown, slug = "acme") => {
  const r = await h.app.inject({ method, url: `/api/v1/public/${slug}/m/scheduling${path}`, ...(body !== undefined ? { payload: body as object } : {}) });
  return { status: r.statusCode, body: r.body ? r.json() : null, headers: r.headers };
};
const seen = new Set<string>();
async function pump() {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tA)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope); }
  }
}
const types = async () => (await h.events(tA)).map((e) => e.type).filter((t) => t.startsWith("scheduling."));

beforeAll(async () => {
  h = await setup([scheduling]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol, dave, bob] = await Promise.all([h.token("alice"), h.token("carol"), h.token("dave"), h.token("bob")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  await h.client(bob).post("/tenants", { slug: "beta", name: "Beta" });
  carolId = (await h.client(carol).get("/me")).body.userId;
  daveId = (await h.client(dave).get("/me")).body.userId;
  await A().post("/members", { email: "carol@example.com", roles: ["member"] });
  await A().post("/members", { email: "dave@example.com", roles: ["member"] });
  expect((await A().patch("/modules/scheduling/settings", { timezone: TZ, minNoticeMin: 60 })).status).toBe(200);
  expect((await A().post("/modules/scheduling/enable", {})).status).toBe(200);
  // derive the UTC offset on that Monday from Postgres-independent Intl
  at = (hhmm: string) => {
    const guess = Date.parse(`${monday}T${hhmm}:00Z`);
    const off = Date.parse(`${monday}T${berlinTime(new Date(guess).toISOString())}:00Z`) - guess;
    return new Date(guess - off).toISOString();
  };
});
afterAll(() => h?.teardown());

describe("services and availability", () => {
  it("only service managers create services; slugs unique; hosts must be members", async () => {
    expect((await Cm().post(`${base}/services`, { name: "Consultation", durationMin: 30 })).status).toBe(403);
    const s = await A().post(`${base}/services`, { name: "Consultation", durationMin: 30, bufferMin: 10, location: "Main St 1", hostIds: [carolId, daveId] });
    expect(s.status).toBe(201);
    expect(s.body).toMatchObject({ slug: "consultation", hosts: [{ id: expect.any(String), name: expect.any(String) }, expect.anything()] });
    svcId = s.body.id;
    expect((await A().post(`${base}/services`, { name: "Consultation", durationMin: 15 })).status).toBe(409);
    expect((await A().post(`${base}/services`, { name: "X", durationMin: 15, hostIds: ["0190aaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa"] })).status).toBe(422);
  });
  it("members set their own hours, not other people's", async () => {
    const rules = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMin: 540, endMin: 720 }));   // 09:00-12:00
    expect((await Cm().put(`${base}/hours`, { rules })).status).toBe(200);
    expect((await Cm().put(`${base}/hours`, { hostId: daveId, rules })).status).toBe(403);
    expect((await Cm().put(`${base}/hours`, { rules: [{ weekday: 1, startMin: 540, endMin: 720 }, { weekday: 1, startMin: 600, endMin: 660 }] })).status).toBe(422);
    expect((await A().put(`${base}/hours`, { hostId: daveId, rules })).status).toBe(200);
    expect((await Cm().get(`${base}/hours`)).body).toMatchObject({ hostId: carolId, timezone: TZ, rules: expect.arrayContaining([{ weekday: 1, startMin: 540, endMin: 720 }]) });
  });
  it("slots follow the business time zone, step and duration", async () => {
    const r = await Cm().get(`${base}/services/${svcId}/slots?from=${monday}&to=${monday}`);
    expect(r.status).toBe(200);
    expect(r.body.data.map((s: { start: string }) => berlinTime(s.start))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"]);
    expect(r.body.data[0].hosts.sort()).toEqual([carolId, daveId].sort());
  });
  it("time off removes a host's slots", async () => {
    expect((await h.client(dave, tA).post(`${base}/time-off`, { startsAt: at("09:00"), endsAt: at("10:00"), reason: "Dentist" })).status).toBe(201);
    const r = await Cm().get(`${base}/services/${svcId}/slots?from=${monday}&to=${monday}`);
    expect(r.body.data[0].hosts).toEqual([carolId]);
    expect(r.body.data[2].hosts.length).toBe(2);
  });
});

describe("public booking page", () => {
  let token: string, bookingId: string;
  it("shows public services and slots without host details", async () => {
    const i = await pub("GET", "/info");
    expect(i.status).toBe(200);
    expect(i.body).toMatchObject({ timezone: TZ, services: [{ slug: "consultation", name: "Consultation", durationMin: 30, location: "Main St 1" }] });
    const s = await pub("GET", `/services/consultation/slots?from=${monday}&to=${monday}`);
    expect(s.body.data).toHaveLength(6);
    expect(s.body.data[0]).toEqual({ start: at("09:00"), end: at("09:30") });
    expect(s.headers["cache-control"]).toBe("no-store");
  });
  it("books a slot, returns a manage token once, links a contact", async () => {
    const r = await pub("POST", "/services/consultation/book", { start: at("09:00"), name: "Grace Hopper", email: "Grace@Example.com", phone: "+49 30 1234" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ service: "Consultation", status: "confirmed", name: "Grace Hopper", token: expect.stringMatching(/^[\w-]{43}$/) });
    ({ token, id: bookingId } = r.body);
    const b = (await Cm().get(`${base}/bookings/${bookingId}`)).body;
    expect(b).toMatchObject({ hostId: carolId, source: "public", customerEmail: "grace@example.com", serviceName: "Consultation" });
    await pump();
    const linked = (await Cm().get(`${base}/bookings/${bookingId}`)).body;
    expect(linked.contactId).toEqual(expect.any(String));
    expect((await A().get(`/contacts/${linked.contactId}`)).body).toMatchObject({ firstName: "Grace", lastName: "Hopper", email: "grace@example.com" });
  });
  it("never double-books; buffer keeps the next slot free", async () => {
    expect((await pub("POST", "/services/consultation/book", { start: at("09:00"), name: "X", email: "x@example.com" })).status).toBe(409);
    const s = await pub("GET", `/services/consultation/slots?from=${monday}&to=${monday}`);
    expect(s.body.data.map((x: { start: string }) => berlinTime(x.start))).toEqual(["10:00", "10:30", "11:00", "11:30"]); // 09:30 blocked by 10 min buffer; dave off until 10
    expect((await pub("POST", "/services/consultation/book", { start: at("10:00"), name: "A", email: "a@example.com" })).status).toBe(201);
    expect((await pub("POST", "/services/consultation/book", { start: at("10:00"), name: "B", email: "b@example.com" })).status).toBe(201);
    expect((await pub("POST", "/services/consultation/book", { start: at("10:00"), name: "C", email: "c@example.com" })).status).toBe(409);
    expect((await pub("POST", "/services/consultation/book", { start: at("09:10"), name: "D", email: "d@example.com" })).status).toBe(409); // not a slot
  });
  it("the database itself refuses overlapping bookings", async () => {
    await expect(h.asOwner(tA, (tx) => tx`
      insert into scheduling_bookings (id, tenant_id, service_id, host_id, starts_at, ends_at, blocked, source, customer_name)
      values (gen_random_uuid(), ${tA}, ${svcId}, ${carolId}, ${at("09:15")}, ${at("09:45")}, tstzrange(${at("09:15")}::timestamptz, ${at("09:45")}::timestamptz), 'internal', 'X')`))
      .rejects.toThrow(/conflicting key value violates exclusion constraint/);
  });
  it("manage link: wrong token looks like not found; right token cancels and frees the slot", async () => {
    expect((await pub("GET", `/bookings/${bookingId}?token=${"x".repeat(43)}`)).status).toBe(404);
    expect((await pub("GET", `/bookings/${bookingId}?token=${token}`)).body).toMatchObject({ status: "confirmed", service: "Consultation" });
    const c = await pub("POST", `/bookings/${bookingId}/cancel`, { token, reason: "Sick" });
    expect(c.body.status).toBe("cancelled");
    expect((await pub("POST", `/bookings/${bookingId}/cancel`, { token })).status).toBe(409);
    const s = await pub("GET", `/services/consultation/slots?from=${monday}&to=${monday}`);
    expect(berlinTime(s.body.data[0].start)).toBe("09:00");
    expect(await types()).toEqual(expect.arrayContaining(["scheduling.booking.created", "scheduling.booking.cancelled"]));
  });
  it("blocks bots, abuse, and closed or unknown pages", async () => {
    expect((await pub("POST", "/services/consultation/book", { start: at("11:00"), name: "Bot", email: "bot@example.com", website: "spam" })).status).toBe(400);
    for (const t of ["11:00", "11:30"]) expect((await pub("POST", "/services/consultation/book", { start: at(t), name: "Q", email: "q@example.com" })).status).toBe(201);
    await pub("POST", "/services/consultation/book", { start: at("09:00"), name: "Q", email: "q@example.com" });
    expect((await pub("POST", "/services/consultation/book", { start: at("09:30"), name: "Q", email: "q@example.com" })).status).toBe(409); // 4th upcoming
    expect((await pub("GET", "/info", undefined, "beta")).status).toBe(404);       // module off there
    expect((await pub("GET", "/info", undefined, "nope")).status).toBe(404);
    expect((await pub("GET", "/services/nope/slots?from=2026-01-01&to=2026-01-01")).status).toBe(404);
    await A().patch("/modules/scheduling/settings", { publicBooking: false });
    expect((await pub("GET", "/info")).status).toBe(404);
    await A().patch("/modules/scheduling/settings", { publicBooking: true });
    await A().patch(`${base}/services/${svcId}`, { isPublic: false });
    expect((await pub("GET", "/info")).body.services).toHaveLength(0);
    await A().patch(`${base}/services/${svcId}`, { isPublic: true });
    expect((await A().get(`${base}/services`)).body.data[0]).toMatchObject({ bufferMin: 10, hosts: expect.arrayContaining([expect.objectContaining({ id: carolId })]) }); // patch kept the rest
  });
  it("public requests cannot reach team routes", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/v1/m/scheduling/bookings" });
    expect(r.statusCode).toBe(401);
  });
});

describe("team bookings", () => {
  let id: string, contactId: string;
  it("books for a contact, even outside hours, but never on top of another booking", async () => {
    contactId = (await A().post("/contacts", { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" })).body.id;
    const r = await Cm().post(`${base}/bookings`, { serviceId: svcId, start: at("14:00"), hostId: carolId, contactId, outsideHours: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ customerName: "Ada Lovelace", customerEmail: "ada@example.com", contactId, source: "internal", hostName: "carol" });
    id = r.body.id;
    expect((await Cm().post(`${base}/bookings`, { serviceId: svcId, start: at("14:15"), hostId: carolId, name: "Y", outsideHours: true })).status).toBe(409);
    expect((await Cm().post(`${base}/bookings`, { serviceId: svcId, start: at("14:00"), name: "Y" })).status).toBe(409); // outside hours
    expect((await Cm().get(`${base}/bookings?contactId=${contactId}`)).body.data).toHaveLength(1);
  });
  it("reschedules into an open slot and records outcomes only after start", async () => {
    const tue = new Date(Date.parse(`${monday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const free = (await Cm().get(`${base}/services/${svcId}/slots?from=${tue}&to=${tue}&hostId=${carolId}`)).body.data;
    expect(free.length).toBeGreaterThan(0);
    expect((await Cm().post(`${base}/bookings/${id}/reschedule`, { start: at("10:00") })).status).toBe(409); // carol is busy then
    const r = await Cm().post(`${base}/bookings/${id}/reschedule`, { start: free[0].start });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ startsAt: free[0].start, hostId: carolId });
    expect((await Cm().post(`${base}/bookings/${id}/outcome`, { status: "completed" })).status).toBe(409);
    const c = await Cm().post(`${base}/bookings/${id}/cancel`, { reason: "Client asked" });
    expect(c.body).toMatchObject({ status: "cancelled", cancelReason: "Client asked" });
    expect(await types()).toContain("scheduling.booking.rescheduled");
  });
  it("past bookings get an outcome", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setUTCMinutes(0, 0, 0);
    const p = await A().post(`${base}/bookings`, { serviceId: svcId, start: yesterday.toISOString(), hostId: daveId, name: "Walk-in", outsideHours: true });
    expect(p.status).toBe(201);
    expect((await A().post(`${base}/bookings/${p.body.id}/outcome`, { status: "no_show" })).body.status).toBe("no_show");
  });
  it("summary lists the week", async () => {
    const s = (await Cm().get(`${base}/summary`)).body;
    expect(s.timezone).toBe(TZ);
    expect(s.next7Days).toBeGreaterThanOrEqual(0);
  });
});
