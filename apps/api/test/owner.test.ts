import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runDueJobs } from "@office/platform";
import kpi from "@office/module-kpi";
import { setup } from "./harness.ts";

/** The program owner (boss@example.com in the harness) sets up businesses and pauses them, but can't see inside. */
let h: Awaited<ReturnType<typeof setup>>;
let relay: postgres.Sql;
let boss: string, olivia: string, sam: string, stranger: string;
const tokenOf = (link: string) => link.split("/").pop()!;

beforeAll(async () => {
  h = await setup([kpi]);
  relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  [boss, olivia, sam, stranger] = await Promise.all([
    h.token("boss"), h.token("olivia"), h.token("sam"), h.token("stranger"),
  ]);
});
afterAll(async () => { await relay.end(); await h.teardown(); });

describe("program owner", () => {
  let bizId: string;

  it("only the program owner sees the program admin area", async () => {
    expect((await h.client(boss).get("/me")).body).toMatchObject({ platformAdmin: true, selfSignup: true });
    expect((await h.client(olivia).get("/me")).body).toMatchObject({ platformAdmin: false });
    expect((await h.client(olivia).get("/platform/businesses")).status).toBe(403);
    expect((await h.client(olivia).post("/platform/businesses", { name: "X", slug: "xx-co", ownerEmail: "x@example.com" })).status).toBe(403);
    // An unverified email never counts, even if it's on the list.
    const unverified = await h.token("boss", "boss@example.com", { email_verified: undefined });
    expect((await h.client(unverified).get("/platform/businesses")).status).toBe(403);
  });

  it("creates a business and invites its owner, who joins as owner", async () => {
    const r = await h.client(boss).post("/platform/businesses", { name: "Bakery Ltd", slug: "bakery", ownerEmail: "Olivia@Example.com" });
    expect(r.status).toBe(201);
    expect(r.body.invitation).toMatchObject({ email: "olivia@example.com", emailed: false, link: expect.stringContaining("/invite/") });
    bizId = r.body.business.id;

    let list = (await h.client(boss).get("/platform/businesses")).body.items;
    expect(list.find((b: { id: string }) => b.id === bizId)).toMatchObject({
      name: "Bakery Ltd", status: "active", members: 0, owners: [], ownerInvite: { email: "olivia@example.com", expired: false },
    });

    // The wrong person can't take it.
    expect((await h.client(sam).post("/invitations/accept", { tenantId: bizId, token: tokenOf(r.body.invitation.link) })).status).toBe(403);
    const acc = await h.client(olivia).post("/invitations/accept", { tenantId: bizId, token: tokenOf(r.body.invitation.link) });
    expect(acc.status).toBe(200);
    expect((await h.client(olivia, bizId).get("/me/access")).body.permissions).toContain("*");

    list = (await h.client(boss).get("/platform/businesses")).body.items;
    expect(list.find((b: { id: string }) => b.id === bizId)).toMatchObject({
      members: 1, owners: [{ email: "olivia@example.com" }], ownerInvite: null,
    });
    const audit = await h.asOwner(bizId, (tx) => tx`select action, actor_id from audit_log order by seq`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["tenant.created", "member.added"]));
    expect(audit.find((a) => a.action === "tenant.created")!.actor_id).toBe("platform:boss@example.com");
  });

  it("can't open a business's data", async () => {
    const asBoss = h.client(boss, bizId);
    expect((await asBoss.get("/contacts")).status).toBe(404);
    expect((await asBoss.get("/members")).status).toBe(404);
    expect((await asBoss.get("/me/access")).status).toBe(404);
  });

  it("a new owner invitation replaces the open one", async () => {
    const a = await h.client(boss).post(`/platform/businesses/${bizId}/owner-invite`, { email: "sam@example.com" });
    const b = await h.client(boss).post(`/platform/businesses/${bizId}/owner-invite`, { email: "sam@example.com" });
    expect(a.status).toBe(201);
    expect((await h.client(sam).post("/invitations/accept", { tenantId: bizId, token: tokenOf(a.body.invitation.link) })).status).toBe(409);
    expect((await h.client(sam).post("/invitations/accept", { tenantId: bizId, token: tokenOf(b.body.invitation.link) })).status).toBe(200);
    const roles = (await h.client(olivia, bizId).get("/members")).body.find((m: { email: string }) => m.email === "sam@example.com").roles;
    expect(roles).toContain("owner");
    expect((await h.client(boss).post(`/platform/businesses/00000000-0000-7000-8000-000000000000/owner-invite`, { email: "a@b.co" })).status).toBe(404);
  });

  it("pausing closes the business (data kept), stops its jobs, and reactivating opens it again", async () => {
    const own = h.client(olivia, bizId);
    await own.post("/contacts", { firstName: "Kept" });
    expect((await own.post("/modules/kpi/enable", {})).status).toBe(200);

    expect((await h.client(olivia).post(`/platform/businesses/${bizId}/pause`, {})).status).toBe(403);
    expect((await h.client(boss).post(`/platform/businesses/${bizId}/pause`, {})).body).toMatchObject({ status: "suspended" });

    const blocked = await own.get("/contacts");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("tenant_paused");
    // Outsiders still just see "not found".
    expect((await h.client(stranger, bizId).get("/contacts")).status).toBe(404);
    // Members still see it in their list, marked paused.
    expect((await h.client(olivia).get("/me")).body.tenants).toEqual([expect.objectContaining({ id: bizId, tenantStatus: "suspended" })]);

    const deps = { db: h.db, registry: h.registry, secrets: h.secrets };
    await runDueJobs(relay, deps); // creates the job rows
    await relay`update module_job_state set next_run_at = now() where tenant_id = ${bizId}`;
    expect(await runDueJobs(relay, deps)).toBe(0);

    expect((await h.client(boss).post(`/platform/businesses/${bizId}/resume`, {})).body).toMatchObject({ status: "active" });
    await relay`update module_job_state set next_run_at = now() where tenant_id = ${bizId}`;
    expect(await runDueJobs(relay, deps)).toBe(1);
    const contacts = (await own.get("/contacts")).body.data;
    expect(contacts.map((c: { firstName: string }) => c.firstName)).toContain("Kept");

    const audit = await h.asOwner(bizId, (tx) => tx`select action from audit_log order by seq`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["tenant.paused", "tenant.resumed"]));
  });

  it("rejects a taken web address", async () => {
    expect((await h.client(boss).post("/platform/businesses", { name: "Again", slug: "bakery", ownerEmail: "a@example.com" })).status).toBe(409);
  });
});

describe("self sign-up switch", () => {
  it("when off, only the program owner can create businesses", async () => {
    const off = await setup([], { selfSignup: false });
    try {
      const [anyone, owner] = await Promise.all([off.token("anyone"), off.token("boss")]);
      expect((await off.client(anyone).get("/me")).body).toMatchObject({ selfSignup: false, platformAdmin: false, tenants: [] });
      const r = await off.client(anyone).post("/tenants", { slug: "mine", name: "Mine" });
      expect(r.status).toBe(403);
      expect((await off.client(owner).post("/tenants", { slug: "boss-own", name: "Boss" })).status).toBe(201);
    } finally {
      await off.teardown();
    }
  });
});
