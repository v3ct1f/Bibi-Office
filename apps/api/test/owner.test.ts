import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { runDueJobs } from "@office/platform";
import kpi from "@office/module-kpi";
import { defineModule } from "@office/sdk";
import { setup } from "./harness.ts";

/** The program owner (boss@example.com in the harness) sets up businesses and pauses them, but can't see inside. */
/** A tiny feature that needs KPI, to check dependencies. */
const addon = defineModule({
  manifest: { key: "addon", name: "Add-on", version: "1.0.0", office: "^1.0", dependsOn: ["kpi"], permissions: { declares: [{ key: "addon:a.read", label: "Read" }] } },
});
let h: Awaited<ReturnType<typeof setup>>;
let relay: postgres.Sql;
let boss: string, olivia: string, sam: string, stranger: string;
const tokenOf = (link: string) => link.split("/").pop()!;

beforeAll(async () => {
  h = await setup([kpi, addon]);
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

  it("can look at a business's data but not change it (see 'program owner viewing a business')", async () => {
    const asBoss = h.client(boss, bizId);
    expect((await asBoss.get("/contacts")).status).toBe(200);
    expect((await asBoss.get("/members")).status).toBe(200);
    expect((await asBoss.get("/me/access")).body.viewing).toBe(true);
    expect((await asBoss.post("/contacts", { firstName: "X" })).status).toBe(403);
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

describe("features per business", () => {
  it("the program owner chooses what a business can turn on", async () => {
    const r = await h.client(boss).post("/platform/businesses", { name: "Florist", slug: "florist", ownerEmail: "fay@example.com" });
    const id = r.body.business.id as string;
    const fay = await h.token("fay");
    expect((await h.client(fay).post("/invitations/accept", { tenantId: id, token: tokenOf(r.body.invitation.link) })).status).toBe(200);
    const own = h.client(fay, id);
    const B = () => h.client(boss);

    expect((await B().get("/platform/features")).body.items.map((f: { key: string }) => f.key).sort()).toEqual(["addon", "kpi"]);
    expect((await h.client(fay).get("/platform/features")).status).toBe(403);
    expect((await h.client(fay).put(`/platform/businesses/${id}/features`, { features: [] })).status).toBe(403);
    // By default everything is included.
    expect((await own.get("/modules")).body.every((m: { allowed: boolean }) => m.allowed)).toBe(true);
    await own.post("/modules/kpi/enable", {});
    await own.post("/modules/addon/enable", {});

    // Choosing only the add-on also includes what it needs.
    expect((await B().put(`/platform/businesses/${id}/features`, { features: ["addon"] })).body).toEqual({ features: ["addon", "kpi"], turnedOff: [] });
    expect((await B().put(`/platform/businesses/${id}/features`, { features: ["nope"] })).status).toBe(400);

    // Taking KPI away turns off the add-on first, then KPI; data is kept, and they can't turn it back on.
    expect((await B().put(`/platform/businesses/${id}/features`, { features: [] })).body).toEqual({ features: [], turnedOff: ["addon", "kpi"] });
    const mods = (await own.get("/modules")).body as { key: string; enabled: boolean; allowed: boolean }[];
    expect(mods.map(({ key, enabled, allowed }) => ({ key, enabled, allowed })).sort((a, b) => a.key.localeCompare(b.key)))
      .toEqual([{ key: "addon", enabled: false, allowed: false }, { key: "kpi", enabled: false, allowed: false }]);
    const denied = await own.post("/modules/kpi/enable", {});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe("feature_not_included");

    const list = (await B().get("/platform/businesses")).body.items.find((b: { id: string }) => b.id === id);
    expect(list).toMatchObject({ allowedFeatures: [], features: [] });

    // Back to everything.
    expect((await B().put(`/platform/businesses/${id}/features`, { features: null })).body).toEqual({ features: null, turnedOff: [] });
    expect((await own.post("/modules/kpi/enable", {})).status).toBe(200);
    const audit = await h.asOwner(id, (tx) => tx`select action, actor_id from audit_log where action = 'tenant.features_set'`);
    expect(audit).toHaveLength(3); // the rejected "nope" save left no trace
    expect(audit[0]!.actor_id).toBe("platform:boss@example.com");
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

describe("program owners", () => {
  type O = { id: string; email: string; signedIn: boolean; you: boolean; addedBy: string };
  const owners = async (t: string) => (await h.client(t).get("/platform/owners")).body.items as O[];

  it("starts with the configured owner; others can't see or change the list", async () => {
    expect(await owners(boss)).toEqual([expect.objectContaining({ email: "boss@example.com", signedIn: true, you: true, addedBy: "config" })]);
    const sam = await h.token("sam");
    expect((await h.client(sam).get("/platform/owners")).status).toBe(403);
    expect((await h.client(sam).post("/platform/owners", { email: "sam@example.com" })).status).toBe(403);
    expect((await h.client(sam).post("/platform/owners/transfer", { email: "sam@example.com" })).status).toBe(403);
  });

  it("adds a co-owner, who gets access when they sign in, and can be removed", async () => {
    const r = await h.client(boss).post("/platform/owners", { email: "Cora@Example.com" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ email: "cora@example.com", signedIn: false });
    expect((await h.client(boss).post("/platform/owners", { email: "cora@example.com" })).status).toBe(409);

    const cora = await h.token("cora");
    expect((await h.client(cora).get("/me")).body.platformAdmin).toBe(true);
    expect((await h.client(cora).get("/platform/businesses")).status).toBe(200);
    expect((await owners(boss)).find((o) => o.email === "cora@example.com")).toMatchObject({ signedIn: true, addedBy: "boss@example.com" });

    expect((await h.client(boss).del(`/platform/owners/${r.body.id}`)).body).toEqual({ removed: "cora@example.com", self: false });
    expect((await h.client(cora).get("/me")).body.platformAdmin).toBe(false);
    expect((await h.client(cora).get("/platform/businesses")).status).toBe(403);
  });

  it("never leaves the program without an owner who can sign in", async () => {
    const me = (await owners(boss))[0]!;
    // A co-owner who never signed in doesn't count.
    const ghost = (await h.client(boss).post("/platform/owners", { email: "ghost@example.com" })).body;
    const r = await h.client(boss).del(`/platform/owners/${me.id}`);
    expect(r.status).toBe(409);
    expect((await h.client(boss).del(`/platform/owners/${ghost.id}`)).status).toBe(200);
  });

  it("transfers ownership only to someone with an account", async () => {
    expect((await h.client(boss).post("/platform/owners/transfer", { email: "nobody@example.com" })).status).toBe(409);
    expect((await h.client(boss).post("/platform/owners/transfer", { email: "boss@example.com" })).status).toBe(400);

    expect((await h.client(boss).post("/platform/owners/transfer", { email: "olivia@example.com" })).body).toEqual({ to: "olivia@example.com", emailed: false });
    expect((await h.client(boss).get("/me")).body.platformAdmin).toBe(false);
    expect((await h.client(boss).get("/platform/owners")).status).toBe(403);
    expect(await owners(olivia)).toEqual([expect.objectContaining({ email: "olivia@example.com", you: true })]);
    // Olivia still owns her own business as before.
    expect((await h.client(olivia).get("/me")).body.tenants.length).toBeGreaterThan(0);

    // ... and hands it back; the history records every change.
    await h.client(olivia).post("/platform/owners/transfer", { email: "boss@example.com" });
    expect((await h.client(boss).get("/me")).body.platformAdmin).toBe(true);
    const log = await h.ownerSql`select actor, action from platform_audit order by created_at, id`;
    expect(log.map((l) => l.action)).toEqual(["owners.seeded", "owner.added", "owner.removed", "owner.added", "owner.removed", "ownership.transferred", "ownership.transferred"]);
  });
});

describe("deleting a business", () => {
  it("needs the name typed in", async () => {
    const r = await h.client(boss).post("/platform/businesses", { name: "Doomed Deli", slug: "doomed-deli", ownerEmail: "dina@example.com" });
    const id = r.body.business.id;
    const link = r.body.invitation.link as string;
    const dina = await h.token("dina");
    await h.client(dina).post("/invitations/accept", { tenantId: id, token: tokenOf(link) });
    expect((await h.client(dina, id).get("/me/access")).status).toBe(200);
    const pending = (await h.client(boss).post(`/platform/businesses/${id}/owner-invite`, { email: "dan@example.com" })).body.invitation.link as string;

    const fresh = boss;
    // Only program owners.
    expect((await h.client(dina).post(`/platform/businesses/${id}/delete`, { confirmName: "Doomed Deli" })).status).toBe(403);
    // The name must match.
    expect((await h.client(fresh).post(`/platform/businesses/${id}/delete`, { confirmName: "Doomed" })).status).toBe(400);

    const del = await h.client(fresh).post(`/platform/businesses/${id}/delete`, { confirmName: "  doomed deli " });
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ id, status: "deleted" });

    // Gone for everyone: not listed, members can't open it, the open invitation is dead, can't be paused or deleted again.
    expect((await h.client(boss).get("/platform/businesses")).body.items.some((b: { id: string }) => b.id === id)).toBe(false);
    expect((await h.client(dina, id).get("/me/access")).status).toBe(404);
    expect((await h.client(dina).get("/me")).body.tenants.some((t: { id: string }) => t.id === id)).toBe(false);
    const dan = await h.token("dan");
    expect((await h.client(dan).post("/invitations/accept", { tenantId: id, token: tokenOf(pending) })).status).toBeGreaterThanOrEqual(400);
    expect((await h.client(fresh).post(`/platform/businesses/${id}/pause`, undefined)).status).toBe(404);
    expect((await h.client(fresh).post(`/platform/businesses/${id}/delete`, { confirmName: "Doomed Deli" })).status).toBe(404);

    const [a] = await h.asOwner(id, (tx) => tx`select action, actor_id from audit_log where action = 'tenant.deleted'`);
    expect(a).toMatchObject({ action: "tenant.deleted", actor_id: "platform:boss@example.com" });
  });
});

describe("program owner viewing a business", () => {
  it("can look inside any business read-only, and each visit is logged in its history", async () => {
    const r = await h.client(boss).post("/platform/businesses", { name: "Glass House", slug: "glass-house", ownerEmail: "gina@example.com" });
    const id = r.body.business.id;
    const gina = await h.token("gina");
    await h.client(gina).post("/invitations/accept", { tenantId: id, token: tokenOf(r.body.invitation.link) });
    const contact = (await h.client(gina, id).post("/contacts", { firstName: "Carl", lastName: "Customer" })).body;

    const B = h.client(boss, id);
    const access = (await B.get("/me/access")).body;
    expect(access).toMatchObject({ viewing: true, tenant: { name: "Glass House" } });
    expect(access.permissions).toContain("core:contacts.read");
    expect(access.permissions.some((p: string) => p.endsWith(".write") || p.endsWith(".manage") || p === "*")).toBe(false);
    expect((await B.get("/contacts")).body.data.map((c: { id: string }) => c.id)).toContain(contact.id);
    expect((await B.get(`/contacts/${contact.id}`)).status).toBe(200);

    // Nothing can be changed, even where a read permission would be enough to reach the route.
    const post = await B.post("/contacts", { firstName: "Sneaky" });
    expect(post.status).toBe(403);
    expect(post.body.code ?? post.body.error?.code).toBe("read_only");
    expect((await B.patch(`/contacts/${contact.id}`, { firstName: "Changed" })).status).toBe(403);
    expect((await B.del(`/contacts/${contact.id}`)).status).toBe(403);
    // No secrets: API keys need a manage permission the viewer never has.
    expect((await B.get("/api-keys")).status).toBe(403);

    // One history entry per visit (not per request), visible to the business.
    const log = (await h.client(gina, id).get("/audit")).body;
    const visits = (log.data ?? log.items ?? log).filter((a: { action: string }) => a.action === "tenant.viewed_by_program_owner");
    expect(visits).toHaveLength(1);
    expect(visits[0].actorId ?? visits[0].actor_id ?? visits[0].actor?.id).toBe("platform:boss@example.com");

    // Others still can't tell the business exists; an unverified email never counts.
    const stranger = await h.token("stranger");
    expect((await h.client(stranger, id).get("/me/access")).status).toBe(404);
    const unverified = await h.token("boss", "boss@example.com", { email_verified: undefined });
    expect((await h.client(unverified, id).get("/me/access")).status).toBe(404);

    // Paused: members are shut out, the program owner can still look.
    await h.client(boss).post(`/platform/businesses/${id}/pause`, undefined);
    expect((await h.client(gina, id).get("/contacts")).status).toBe(403);
    expect((await B.get("/contacts")).status).toBe(200);
  });
});
