import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHmac } from "node:crypto";
import postgres from "postgres";
import { dispatchEvent, InlineRunner, installModules, ModuleRegistry, deliverDue, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import { setup } from "./harness.ts";
import sample from "./fixtures/sample/index.ts";
import bad from "./fixtures/bad/index.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, carol: string, tA: string;
let exec: ExecDeps;
const C = () => h.client(alice, tA);

/** Run the dispatcher over every not-yet-dispatched outbox event (what the worker does via NATS). */
const seen = new Set<string>();
async function pump(tenantId = tA, max = 50) {
  const runner = new InlineRunner(exec, 1);
  let n = 0;
  for (let i = 0; i < max; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); n++; }
  }
  return n;
}

beforeAll(async () => {
  h = await setup([sample]);
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, files: h.files, http: { allowPrivate: true, requireHttps: false } };
  [alice, carol] = await Promise.all([h.token("alice"), h.token("carol")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  await h.client(carol).get("/me");
  await C().post("/members", { email: "carol@example.com", roles: ["member"] });
});
afterAll(() => h.teardown());

describe("SDK + installer", () => {
  it("rejects manifests that don't match code", async () => {
    const { defineModule } = await import("@office/sdk");
    expect(() => defineModule({ manifest: { key: "x1", name: "X", version: "1.0.0", office: "^1", events: { subscribes: ["core.contact.created"] } } }))
      .toThrow(/has no handler/);
    expect(() => defineModule({ manifest: { key: "x2", name: "X", version: "1.0.0", office: "^1", permissions: { declares: [{ key: "crm:x", label: "x" }] } } }))
      .toThrow(/must start with "x2:"/);
  });
  it("refuses module tables without tenant RLS", async () => {
    await expect(installModules(h.tdb.ownerUrl, new ModuleRegistry([bad]), () => {})).rejects.toThrow(/bad_things/);
  });
  it("detects dependency cycles and missing deps", async () => {
    const { defineModule } = await import("@office/sdk");
    const a = defineModule({ manifest: { key: "aa", name: "A", version: "1.0.0", office: "^1", dependsOn: ["bb"] } });
    expect(() => new ModuleRegistry([a])).toThrow(/missing bb/);
  });
});

describe("module lifecycle", () => {
  it("routes are 404 until enabled; settings validated; secrets sealed", async () => {
    const c = C();
    const contact = (await c.post("/contacts", { firstName: "Ann", email: "ann@x.com" })).body;
    expect((await c.get(`/m/sample/notes?contactId=${contact.id}`)).status).toBe(404);

    expect((await h.client(carol, tA).post("/modules/sample/enable", {})).status).toBe(403);
    expect((await c.patch("/modules/sample/settings", { greeting: 42 })).status).toBe(400);
    expect((await c.patch("/modules/sample/settings", { nope: 1 })).status).toBe(400);
    const s = await c.patch("/modules/sample/settings", { greeting: "Hi", apiToken: "tok_secret" });
    expect(s.status).toBe(200);
    expect(JSON.stringify(s.body)).not.toContain("tok_secret");
    expect(s.body.secretsSet).toEqual(["apiToken"]);
    const raw = await h.asOwner(tA, (tx) => tx`select settings, secrets from tenant_modules`);
    expect(JSON.stringify(raw[0]!.settings)).not.toContain("tok_secret");
    expect(Buffer.from(raw[0]!.secrets).toString()).not.toContain("tok_secret");

    expect((await c.post("/modules/sample/enable", {})).body).toEqual({ key: "sample", enabled: true });
    const list = (await c.get("/modules")).body;
    expect(list[0]).toMatchObject({ key: "sample", enabled: true, settings: { greeting: "Hi" }, secretsSet: ["apiToken"] });

    const n = await c.post("/m/sample/notes", { contactId: contact.id, text: "hello" });
    expect(n.status).toBe(201);
    const got = await c.get(`/m/sample/notes?contactId=${contact.id}`);
    expect(got.body.data).toHaveLength(1);
    expect(got.body.tokenConfigured).toBe(true);
  });

  it("admin role receives module permissions; member without them is denied", async () => {
    const roles = (await C().get("/roles")).body as { key: string; permissions: string[] }[];
    expect(roles.find((r) => r.key === "admin")!.permissions).toEqual(expect.arrayContaining(["sample:notes.read", "sample:notes.write"]));
    expect((await h.client(carol, tA).get(`/m/sample/notes?contactId=00000000-0000-7000-8000-000000000000`)).status).toBe(403);
  });

  it("module ctx blocks undeclared events and undeclared core access", async () => {
    expect((await C().post("/m/sample/misbehave", { what: "emit" })).status).toBe(400);
    const r = await C().post("/m/sample/misbehave", { what: "write" });
    expect(r.status).toBe(403);
    expect(r.body.title).toMatch(/did not declare core:contacts.write/);
  });

  it("module tables are tenant-isolated", async () => {
    const bob = await h.token("bob");
    const tB = (await h.client(bob).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
    await h.client(bob, tB).post("/modules/sample/enable", {});
    const contact = (await h.client(bob, tB).post("/contacts", { firstName: "Zed" })).body;
    const ownNotes = await h.client(bob, tB).get(`/m/sample/notes?contactId=${contact.id}`);
    expect(ownNotes.body.data).toHaveLength(0);
    const annId = (await C().get("/contacts?q=ann")).body.data[0].id;
    expect((await h.client(bob, tB).get(`/m/sample/notes?contactId=${annId}`)).body.data).toHaveLength(0);
  });
});

describe("dispatcher + module handlers", () => {
  it("runs subscribed handlers once per event", async () => {
    await pump(); // drain earlier events
    const ben = (await C().post("/contacts", { firstName: "Ben" })).body;
    await pump();
    const notes = (await C().get(`/m/sample/notes?contactId=${ben.id}`)).body.data;
    expect(notes.map((n: { text: string }) => n.text)).toEqual(["Hi, Ben"]);
    // redelivery of the same event is a no-op
    const ev = (await h.events(tA, "core.contact.created")).find((e) => (e.payload as { id: string }).id === ben.id)!;
    const r = await dispatchEvent({ ...exec, runner: new InlineRunner(exec, 1) }, ev as EventEnvelope);
    expect(r.handlers).toEqual([]);
    expect((await C().get(`/m/sample/notes?contactId=${ben.id}`)).body.data).toHaveLength(1);
  });
});

describe("workflows", () => {
  it("validates definitions", async () => {
    const c = C();
    expect((await c.post("/workflows", { name: "x", trigger: { event: "nope.x.y" }, actions: [{ key: "core.notify", input: { message: "m" } }] })).status).toBe(400);
    expect((await c.post("/workflows", { name: "x", trigger: { event: "core.contact.created" }, actions: [{ key: "evil.run" }] })).status).toBe(400);
    expect((await c.post("/workflows", { name: "x", trigger: { event: "core.contact.created" }, conditions: { bogus_op: [1] }, actions: [{ key: "core.notify", input: { message: "m" } }] })).status).toBe(400);
    expect((await h.client(carol, tA).post("/workflows", { name: "x", trigger: { event: "core.contact.created" }, actions: [{ key: "core.notify", input: { message: "m" } }] })).status).toBe(403);
    const cat = (await c.get("/workflow-catalog")).body;
    expect(cat.actions.map((a: { key: string }) => a.key)).toEqual(expect.arrayContaining(["core.create_task", "sample.add_note"]));
    expect(cat.events).toContain("sample.note.created");
  });

  it("trigger -> condition -> core + module actions with templates", async () => {
    const c = C();
    const wf = await c.post("/workflows", {
      name: "VIP follow-up",
      trigger: { event: "core.contact.created" },
      conditions: { in: ["@vip.com", { var: "payload.email" }] },
      actions: [
        { key: "core.create_task", input: { title: "Call {{payload.firstName}}", dueInDays: 1, priority: 4 } },
        { key: "sample.add_note", input: { contactId: "{{payload.id}}", text: "VIP! task {{steps.0.taskId}}" } },
      ],
    });
    expect(wf.status).toBe(201);
    await pump();
    const vip = (await c.post("/contacts", { firstName: "Vera", email: "vera@vip.com" })).body;
    await c.post("/contacts", { firstName: "Norm", email: "norm@plain.com" });
    await pump();

    const runs = (await c.get(`/workflows/${wf.body.id}/runs`)).body;
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("succeeded");
    expect(runs[0].steps.map((s: { status: string }) => s.status)).toEqual(["succeeded", "succeeded"]);
    const tasks = (await c.get("/tasks")).body.data as { title: string; priority: number; id: string }[];
    const t = tasks.find((x) => x.title === "Call Vera")!;
    expect(t.priority).toBe(4);
    const notes = (await c.get(`/m/sample/notes?contactId=${vip.id}`)).body.data.map((n: { text: string }) => n.text);
    expect(notes).toContain(`VIP! task ${t.id}`);
    // actions are audited as the workflow
    const audit = (await c.get("/audit?entityType=task")).body.data;
    expect(audit[0].actorId).toBe(`workflow:${wf.body.id}`);
  });

  it("fails cleanly: disabled module action, wait on inline runner", async () => {
    const c = C();
    const w1 = (await c.post("/workflows", { name: "wait", trigger: { event: "core.company.created" }, actions: [{ key: "core.wait", input: { seconds: 60 } }] })).body;
    await c.post("/companies", { name: "Initech" });
    await pump();
    const r1 = (await c.get(`/workflows/${w1.id}/runs`)).body[0];
    expect(r1.status).toBe("failed");
    expect(r1.error).toMatch(/Temporal/);
  });

  it("stops infinite loops via event depth", async () => {
    const c = C();
    const w = (await c.post("/workflows", {
      name: "loop", trigger: { event: "core.task.created" },
      actions: [{ key: "core.create_task", input: { title: "again" } }],
    })).body;
    await c.post("/tasks", { title: "seed" });
    await pump(tA, 30);
    const runs = (await c.get(`/workflows/${w.id}/runs?limit=100`)).body as { status: string; error: string }[];
    expect(runs.length).toBeLessThanOrEqual(10);
    expect(runs.some((r) => r.status === "failed" && /too deep/.test(r.error))).toBe(true);
    await c.del(`/workflows/${w.id}`);
  });
});

describe("webhooks", () => {
  let server: Server;
  let url = "";
  const received: { headers: IncomingMessage["headers"]; body: string }[] = [];
  let failNext = 0;
  let relay: postgres.Sql;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
        if (failNext > 0) { failNext--; res.statusCode = 500; return res.end(); }
        received.push({ headers: req.headers, body: b }); res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
    relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  });
  afterAll(async () => { server.close(); await relay.end(); });

  it("blocks SSRF targets at creation", async () => {
    for (const u of ["http://169.254.169.254/latest", "http://10.0.0.1/", "ftp://x.com/", "https://u:p@x.com/"]) {
      expect((await C().post("/webhooks", { url: u, events: ["*"] })).status).toBe(400);
    }
  });

  it("delivers signed events with retry and redelivery", async () => {
    await pump();
    const c = C();
    // created via API with a public-looking host, then pointed at the local receiver (dev allowPrivate)
    const w = await c.post("/webhooks", { url: "https://example.com/hook", events: ["core.contact.*"] });
    expect(w.status).toBe(201);
    expect(w.body.secret).toMatch(/^whsec_/);
    await h.asOwner(tA, (tx) => tx`update webhook_endpoints set url = ${url} where id = ${w.body.id}`);

    await c.post("/contacts", { firstName: "Hook" });
    await c.post("/companies", { name: "NotMatched" });
    await pump();

    failNext = 1;
    const opts = { allowPrivate: true, requireHttps: false };
    expect(await deliverDue(relay, h.secrets, opts)).toBe(1);
    expect(received).toHaveLength(0);
    let d = (await c.get(`/webhooks/${w.body.id}/deliveries`)).body;
    expect(d[0]).toMatchObject({ status: "pending", attempts: 1, statusCode: 500 });

    await h.asOwner(tA, (tx) => tx`update webhook_deliveries set next_attempt_at = now()`);
    expect(await deliverDue(relay, h.secrets, opts)).toBe(1);
    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    expect(headers["office-event-type"]).toBe("core.contact.created");
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(headers["office-signature"]))!;
    expect(createHmac("sha256", w.body.secret).update(`${t}.${body}`).digest("hex")).toBe(v1);
    expect(JSON.parse(body).payload.firstName).toBe("Hook");

    d = (await c.get(`/webhooks/${w.body.id}/deliveries`)).body;
    expect(d[0]).toMatchObject({ status: "delivered", attempts: 2 });
    expect((await c.post(`/webhooks/${w.body.id}/deliveries/${d[0].id}/redeliver`, {})).status).toBe(202);
    await deliverDue(relay, h.secrets, opts);
    expect(received).toHaveLength(2);
    expect(received[1]!.headers["office-event-id"]).toBe(received[0]!.headers["office-event-id"]);
  });

  it("guarded agent blocks private IPs when not allowed", async () => {
    await C().post("/contacts", { firstName: "Blocked" });
    await pump();
    await deliverDue(relay, h.secrets, { allowPrivate: false, requireHttps: false });
    const w = (await C().get("/webhooks")).body[0];
    const d = (await C().get(`/webhooks/${w.id}/deliveries`)).body[0];
    expect(d.lastError).toMatch(/Blocked destination/);
  });
});
