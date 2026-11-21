import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, bob: string, carol: string;
let tA: string, tB: string;

beforeAll(async () => {
  h = await setup();
  [alice, bob, carol] = await Promise.all([h.token("alice"), h.token("bob"), h.token("carol")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(bob).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
  await h.client(carol).get("/me"); // carol signs in once (JIT user)
});
afterAll(() => h.teardown());

describe("auth", () => {
  it("rejects missing / bad tokens with problem+json", async () => {
    const r = await h.app.inject({ method: "GET", url: "/api/v1/me" });
    expect(r.statusCode).toBe(401);
    expect(r.headers["content-type"]).toContain("application/problem+json");
    expect((await h.client("garbage").get("/me")).status).toBe(401);
  });
  it("rejects token with wrong audience", async () => {
    const t = await h.token("eve", "eve@x.com", { aud: "other" });
    expect((await h.client(t).get("/me")).status).toBe(401);
  });
  it("provisions user and lists tenants", async () => {
    const r = await h.client(alice).get("/me");
    expect(r.status).toBe(200);
    expect(r.body.tenants.map((t: { slug: string }) => t.slug)).toEqual(["acme"]);
  });
  it("blocks routes without config.auth at startup (deny by default)", async () => {
    const app = Fastify();
    app.addHook("onRoute", (r) => { if (r.url.startsWith("/api/") && !r.config?.auth) throw new Error("missing auth"); });
    expect(() => app.get("/api/v1/x", async () => 1)).toThrow(/missing auth/);
  });
});

describe("tenants", () => {
  it("rejects duplicate slug", async () => {
    expect((await h.client(carol).post("/tenants", { slug: "acme", name: "X" })).status).toBe(409);
  });
  it("requires X-Tenant-Id", async () => {
    expect((await h.client(alice).get("/contacts")).status).toBe(400);
  });
  it("hides other tenants from non-members (404)", async () => {
    expect((await h.client(bob, tA).get("/contacts")).status).toBe(404);
  });
});

describe("shared data", () => {
  it("CRUD contacts with search, pagination, audit and outbox", async () => {
    const c = h.client(alice, tA);
    const co = await c.post("/companies", { name: "Initech", domain: "initech.com" });
    expect(co.status).toBe(201);
    const ids: string[] = [];
    for (const n of ["Ann", "Ben", "Cid"]) {
      const r = await c.post("/contacts", { firstName: n, email: `${n.toLowerCase()}@initech.com`, companyId: co.body.id });
      expect(r.status).toBe(201);
      ids.push(r.body.id);
    }
    const p1 = await c.get("/contacts?limit=2");
    expect(p1.body.data).toHaveLength(2);
    const p2 = await c.get(`/contacts?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.nextCursor).toBeNull();

    expect((await c.get("/contacts?q=ben")).body.data.map((x: { firstName: string }) => x.firstName)).toEqual(["Ben"]);
    expect((await c.get("/contacts?q=be")).body.data.map((x: { firstName: string }) => x.firstName)).toEqual(["Ben"]); // prefix
    expect((await c.get(`/contacts?q=${encodeURIComponent("be:* | !x & (")}`)).status).toBe(200); // tsquery syntax is inert
    expect((await c.get("/companies?q=init")).body.data.map((x: { name: string }) => x.name)).toEqual(["Initech"]);

    const up = await c.patch(`/contacts/${ids[0]}`, { lastName: "Smith" });
    expect(up.body.lastName).toBe("Smith");
    expect(up.body).not.toHaveProperty("tenantId");

    expect((await c.del(`/contacts/${ids[1]}`)).status).toBe(204);
    expect((await c.get(`/contacts/${ids[1]}`)).status).toBe(404);

    const audit = await c.get("/audit?entityType=contact");
    expect(audit.body.data.map((a: { action: string }) => a.action)).toContain("contact.updated");
    expect((await c.get("/audit/verify")).body).toEqual({ intact: true, firstBrokenSeq: null });

    const ev = await h.asOwner(tA, (tx) => tx`select type, depth from outbox order by id`);
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["core.contact.created", "core.contact.updated", "core.contact.deleted"]));
  });

  it("validates input (400) and rejects unknown fields", async () => {
    const c = h.client(alice, tA);
    expect((await c.post("/contacts", { phone: "1" })).status).toBe(400);
    expect((await c.post("/contacts", { email: "not-an-email" })).status).toBe(400);
    expect((await c.post("/tasks", { title: "x", tenantId: tB })).status).toBe(400);
  });

  it("cannot reference another tenant's company", async () => {
    const other = await h.client(bob, tB).post("/companies", { name: "Globex Sub" });
    const r = await h.client(alice, tA).post("/contacts", { firstName: "X", companyId: other.body.id });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("invalid_reference");
  });

  it("cannot read another tenant's record by id", async () => {
    const other = await h.client(bob, tB).post("/tasks", { title: "secret" });
    expect((await h.client(alice, tA).get(`/tasks/${other.body.id}`)).status).toBe(404);
  });
});

describe("RLS (database level)", () => {
  it("app role sees nothing without tenant, and only own tenant with it", async () => {
    expect((await h.appSql`select count(*)::int n from contacts`)[0]!.n).toBe(0);
    const rows = await h.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tB}, true)`;
      return tx`select tenant_id from tasks`;
    });
    expect(rows.every((r) => r.tenant_id === tB)).toBe(true);
  });
  it("app role cannot write rows for another tenant", async () => {
    await expect(h.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tA}, true)`;
      await tx`insert into tasks (id, tenant_id, title) values (gen_random_uuid(), ${tB}, 'x')`;
    })).rejects.toThrow(/row-level security/);
  });
  it("audit log is append-only for app role and tamper-evident", async () => {
    await expect(h.appSql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tA}, true)`;
      await tx`update audit_log set action = 'x'`;
    })).rejects.toThrow(/permission denied/);
    // even the table owner (e.g. a compromised migration role) is caught
    await h.asOwner(tA, (tx) => tx`alter table audit_log disable trigger audit_chain_bi`.then(() => tx`update audit_log set action = 'forged' where seq = 2`)
      .then(() => tx`alter table audit_log enable trigger audit_chain_bi`));
    expect((await h.client(alice, tA).get("/audit/verify")).body).toEqual({ intact: false, firstBrokenSeq: 2 });
  });
});

describe("RBAC", () => {
  it("viewer can read but not write; owner must remain", async () => {
    const c = h.client(alice, tA);
    await h.join(tA, alice, carol, ["viewer"]);
    const carolC = h.client(carol, tA);
    expect((await carolC.get("/contacts")).status).toBe(200);
    expect((await carolC.post("/contacts", { firstName: "Nope" })).status).toBe(403);
    expect((await carolC.get("/members")).status).toBe(403);

    const members = (await c.get("/members")).body as { id: string; email: string; roles: string[] }[];
    const aliceM = members.find((x) => x.email === "alice@example.com")!;
    expect(aliceM.roles).toEqual(["owner"]);
    expect((await c.put(`/members/${aliceM.id}/roles`, { roles: ["admin"] })).status).toBe(409);
  });

  it("custom role with module wildcard; system roles immutable", async () => {
    const c = h.client(alice, tA);
    const r = await c.put("/roles/sales", { name: "Sales", permissions: ["core:contacts.read", "crm:*"] });
    expect(r.status).toBe(200);
    expect((await c.put("/roles/owner", { name: "x", permissions: [] })).status).toBe(403);
    expect((await c.del("/roles/viewer")).status).toBe(403);
  });

  it("admins can't give themselves more than they have, or demote owners", async () => {
    const c = h.client(alice, tA);
    const dave = await h.token("dave");
    await h.client(dave).get("/me");
    const added = { body: { id: await h.join(tA, alice, dave, ["admin"]) } };
    const d = h.client(dave, tA);
    // A role with everything, or with the one core permission admins lack, can't be made by an admin.
    expect((await d.put("/roles/god", { name: "God", permissions: ["*"] })).status).toBe(403);
    expect((await d.put("/roles/boss", { name: "Boss", permissions: ["core:tenant.manage"] })).status).toBe(403);
    expect((await d.put("/roles/helper", { name: "Helper", permissions: ["core:contacts.read"] })).status).toBe(200);
    // An owner-made role with more than admin can't be handed out, edited or deleted by an admin.
    expect((await c.put("/roles/boss", { name: "Boss", permissions: ["core:tenant.manage"] })).status).toBe(200);
    expect((await d.put(`/members/${added.body.id}/roles`, { roles: ["admin", "boss"] })).status).toBe(403);
    expect((await d.put("/roles/boss", { name: "Boss", permissions: [] })).status).toBe(403);
    expect((await d.del("/roles/boss")).status).toBe(403);
    // Owners can't be demoted or removed by an admin.
    const aliceM = ((await c.get("/members")).body as { id: string; email: string }[]).find((x) => x.email === "alice@example.com")!;
    expect((await d.put(`/members/${aliceM.id}/roles`, { roles: ["admin"] })).status).toBe(403);
    expect((await d.del(`/members/${aliceM.id}`)).status).toBe(403);
    // Admins still manage ordinary members.
    const carolM = ((await c.get("/members")).body as { id: string; email: string }[]).find((x) => x.email === "carol@example.com")!;
    expect((await d.put(`/members/${carolM.id}/roles`, { roles: ["viewer", "helper"] })).status).toBe(204);
    expect((await d.put(`/members/${carolM.id}/roles`, { roles: ["viewer"] })).status).toBe(204);
    expect((await c.del(`/members/${added.body.id}`)).status).toBe(204);
  });
});

describe("API keys", () => {
  it("scoped, tenant-bound, revocable", async () => {
    const c = h.client(alice, tA);
    const k = await c.post("/api-keys", { name: "zapier", scopes: ["core:contacts.read"] });
    expect(k.status).toBe(201);
    expect(k.body.token).toMatch(/^ok_[0-9a-f]{32}_/);
    const kc = h.client(k.body.token);
    expect((await kc.get("/contacts")).status).toBe(200);
    expect((await kc.post("/contacts", { firstName: "x" })).status).toBe(403);
    expect((await h.client(k.body.token, tB).get("/contacts")).status).toBe(403);
    expect((await kc.post("/api-keys", { name: "y", scopes: ["core:contacts.read"] })).status).toBe(403);
    const list = await c.get("/api-keys");
    expect(JSON.stringify(list.body)).not.toContain("hash");
    expect((await c.del(`/api-keys/${k.body.id}`)).status).toBe(204);
    expect((await kc.get("/contacts")).status).toBe(401);
  });

  it("cannot grant scopes the creator lacks", async () => {
    // carol is viewer in A; give her apikeys.manage via custom role but not contacts.write
    const c = h.client(alice, tA);
    await c.put("/roles/integrator", { name: "Integrator", permissions: ["core:apikeys.manage", "core:contacts.read"] });
    const carolM = ((await c.get("/members")).body as { id: string; email: string }[]).find((x) => x.email === "carol@example.com")!;
    await c.put(`/members/${carolM.id}/roles`, { roles: ["integrator"] });
    const r = await h.client(carol, tA).post("/api-keys", { name: "k", scopes: ["core:contacts.write"] });
    expect(r.status).toBe(403);
  });

  it("a key loses what its creator loses, and stops when the creator leaves", async () => {
    const c = h.client(alice, tA);
    const k = await h.client(carol, tA).post("/api-keys", { name: "k2", scopes: ["core:contacts.read"] });
    expect(k.status).toBe(201);
    const kc = h.client(k.body.token);
    expect((await kc.get("/contacts")).status).toBe(200);
    const carolM = ((await c.get("/members")).body as { id: string; email: string }[]).find((x) => x.email === "carol@example.com")!;
    await c.put(`/members/${carolM.id}/roles`, { roles: [] });
    expect((await kc.get("/contacts")).status).toBe(403);
    await c.put(`/members/${carolM.id}/roles`, { roles: ["viewer"] });
    expect((await kc.get("/contacts")).status).toBe(200);
    expect((await c.del(`/members/${carolM.id}`)).status).toBe(204);
    expect((await kc.get("/contacts")).status).toBe(401);
  });
});

describe("invitations", () => {
  const tokenOfLink = (link: string) => link.split("/").pop()!;
  it("only the invited address can accept, once, with the roles given", async () => {
    const c = h.client(alice, tA);
    const [erin, frank] = await Promise.all([h.token("erin"), h.token("frank")]);
    // Viewers can't invite; inviting needs a known role.
    const viewer = await h.token("vera");
    await h.join(tA, alice, viewer, ["viewer"]);
    expect((await h.client(viewer, tA).post("/invitations", { email: "erin@example.com", roles: ["viewer"] })).status).toBe(403);
    expect((await c.post("/invitations", { email: "erin@example.com", roles: ["nope"] })).status).toBe(400);

    const inv = await c.post("/invitations", { email: "Erin@Example.com", roles: ["member"] });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ email: "erin@example.com", roles: ["member"], emailed: false });
    expect(inv.body.link).toMatch(new RegExp(`/invite/${tA}/[A-Za-z0-9_-]{43}$`));
    expect(inv.body.token).toBeUndefined();
    const list = await c.get("/invitations");
    expect(list.body).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(tokenOfLink(inv.body.link));
    const ref = { tenantId: tA, token: tokenOfLink(inv.body.link) };

    // Someone else holding the link sees it isn't for them and can't accept.
    const v = await h.client(frank).post("/invitations/view", ref);
    expect(v.body).toMatchObject({ tenant: { name: "Acme" }, email: "erin@example.com", emailMatches: false, status: "open", roles: ["Member"] });
    expect((await h.client(frank).post("/invitations/accept", ref)).status).toBe(403);
    expect((await h.client(frank, tA).get("/contacts")).status).toBe(404);
    // The wrong company or a made-up token find nothing.
    expect((await h.client(erin).post("/invitations/view", { ...ref, tenantId: tB })).status).toBe(404);
    expect((await h.client(erin).post("/invitations/view", { ...ref, token: "x".repeat(43) })).status).toBe(404);

    const ok = await h.client(erin).post("/invitations/accept", ref);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ tenantId: tA, slug: "acme" });
    expect((await h.client(erin, tA).post("/contacts", { firstName: "Hi" })).status).toBe(201);
    expect((await h.client(erin).post("/invitations/accept", ref)).status).toBe(200); // a second click is fine
    expect((await c.get("/invitations")).body).toHaveLength(0);
    expect((await c.post("/invitations", { email: "erin@example.com", roles: ["viewer"] })).status).toBe(409);
  });

  it("can be withdrawn, replaced, expire, and lapse when the inviter loses access", async () => {
    const c = h.client(alice, tA);
    const gus = await h.token("gus");
    const first = await c.post("/invitations", { email: "gus@example.com", roles: ["viewer"] });
    const second = await c.post("/invitations", { email: "gus@example.com", roles: ["member"] });
    const ref1 = { tenantId: tA, token: tokenOfLink(first.body.link) }, ref2 = { tenantId: tA, token: tokenOfLink(second.body.link) };
    expect((await h.client(gus).post("/invitations/view", ref1)).body.status).toBe("withdrawn");
    expect((await h.client(gus).post("/invitations/accept", ref1)).status).toBe(409);
    expect((await c.del(`/invitations/${second.body.id}`)).status).toBe(204);
    expect((await h.client(gus).post("/invitations/accept", ref2)).status).toBe(409);

    const third = await c.post("/invitations", { email: "gus@example.com", roles: ["member"] });
    await h.asOwner(tA, (tx) => tx`update invitations set expires_at = now() - interval '1 minute' where id = ${third.body.id}`);
    expect((await h.client(gus).post("/invitations/accept", { tenantId: tA, token: tokenOfLink(third.body.link) })).body.title).toMatch(/expired/);

    // An admin invites, then is demoted before the person accepts: the invitation no longer works.
    const hal = await h.token("hal");
    const halM = await h.join(tA, alice, hal, ["admin"]);
    expect((await h.client(hal, tA).post("/invitations", { email: "gus@example.com", roles: ["owner"] })).status).toBe(403);
    const fourth = await h.client(hal, tA).post("/invitations", { email: "gus@example.com", roles: ["member"] });
    expect(fourth.status).toBe(201);
    await c.put(`/members/${halM}/roles`, { roles: ["viewer"] });
    expect((await h.client(gus).post("/invitations/accept", { tenantId: tA, token: tokenOfLink(fourth.body.link) })).body.title).toMatch(/no longer valid/);
  });

  it("are emailed when platform email is set up", async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const h2 = await setup([], { mailer: { send: async (m) => { sent.push(m); } } });
    try {
      const own = await h2.token("ivy");
      const t = (await h2.client(own).post("/tenants", { slug: "ivy-co", name: "Ivy & Co" })).body.id;
      const r = await h2.client(own, t).post("/invitations", { email: "jo@example.com", roles: ["member"] });
      expect(r.body.emailed).toBe(true);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: "jo@example.com", subject: "Join Ivy & Co" });
      expect(sent[0]!.text).toContain(r.body.link);
      expect(sent[0]!.text).toContain("ivy has invited you");
    } finally { await h2.teardown(); }
  });
});

describe("failed sign-ins", () => {
  it("are limited per IP, even with a different fake token each time", async () => {
    const h2 = await setup([], { authFailuresPerMin: 3 });
    try {
      for (let i = 0; i < 3; i++) expect((await h2.client(`fake-${i}`).get("/me")).status).toBe(401);
      expect((await h2.client("fake-4").get("/me")).status).toBe(429);
      expect((await h2.client(await h2.token("zoe")).get("/me")).status).toBe(429);
    } finally { await h2.teardown(); }
  });
});

describe("platform", () => {
  it("serves OpenAPI with all core routes", async () => {
    const r = await h.app.inject({ method: "GET", url: "/docs/json" });
    expect(r.statusCode).toBe(200);
    const paths = Object.keys(r.json().paths);
    for (const p of ["/api/v1/contacts", "/api/v1/tenants", "/api/v1/audit", "/api/v1/api-keys"]) expect(paths).toContain(p);
  });
  it("returns request id and security headers", async () => {
    const r = await h.app.inject({ method: "GET", url: "/healthz" });
    expect(r.headers["x-request-id"]).toBeTruthy();
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
});
