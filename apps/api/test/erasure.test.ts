import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eraseBusiness, listErasableBusinesses } from "@office/core";
import type { Identity } from "../src/identity.ts";
import { eraseDueBusinesses } from "../src/erasure.ts";
import { setup } from "./harness.ts";

/** Permanent erasure: deleted businesses after 30 days, ended subscriptions after 90, or at once on request. */
const deletedAccounts: string[] = [];
const identity: Identity = {
  passwordLink: async () => null,
  createAccount: async () => ({ sub: "x" }),
  deleteAccount: async (sub) => { deletedAccounts.push(sub); },
};
const log = { info: () => {}, warn: () => {} };

let h: Awaited<ReturnType<typeof setup>>;
let boss: string;
beforeAll(async () => { h = await setup([], { identity }); boss = await h.token("boss"); });
afterAll(async () => { await h.teardown(); });

/** A business with an owner who has some data in it. */
async function makeBusiness(slug: string, ownerSub: string) {
  const owner = await h.token(ownerSub);
  const r = await h.client(boss).post("/platform/businesses", { name: `Biz ${slug}`, slug, ownerEmail: `${ownerSub}@example.com` });
  const id = r.body.business.id as string;
  await h.client(owner).post("/invitations/accept", { tenantId: id, token: r.body.invitation.link.split("/").pop() });
  expect((await h.client(owner, id).post("/contacts", { firstName: `Contact of ${slug}` })).status).toBe(201);
  return { id, owner };
}
const tenantRow = async (id: string) => (await h.ownerSql`select status, deleted_at, subscription_ended_at from tenants where id = ${id}`)[0] as { status: string; deleted_at: Date | null; subscription_ended_at: Date | null } | undefined;
const count = async (table: string, id: string) => Number((await h.asOwner(id, (tx) => tx.unsafe(`select count(*)::int as n from ${table} where tenant_id = '${id}'`)))[0]!.n);
const userExists = async (email: string) => (await h.ownerSql`select 1 from users where email = ${email}`).length > 0;
/** The database's refusal comes wrapped by the query library; look at the original message. */
const expectRefused = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x as { message: string; cause?: { message?: string } });
  expect(e).not.toBeNull();
  expect(`${e!.message} ${e!.cause?.message ?? ""}`).toMatch(/not due for erasure/);
};
const del = (id: string, name: string, erase?: boolean) => h.client(boss).post(`/platform/businesses/${id}/delete`, { confirmName: name, ...(erase === undefined ? {} : { erase }) });

describe("erasure", () => {
  it("erase now removes the business, all its records, history and its people's accounts, and keeps only a record that it happened", async () => {
    const { id } = await makeBusiness("gone-now", "greta");
    expect(await count("contacts", id)).toBe(1);
    expect(await count("audit_log", id)).toBeGreaterThan(0);

    const r = await del(id, "Biz gone-now", true);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "deleted", erased: true });

    expect(await tenantRow(id)).toBeUndefined();
    expect(await count("contacts", id)).toBe(0);
    expect(await count("audit_log", id)).toBe(0);
    expect(await count("memberships", id)).toBe(0);
    expect(await userExists("greta@example.com")).toBe(false);
    expect(deletedAccounts).toHaveLength(1);
    const log = await h.ownerSql`select reason, users_erased from erasure_log where tenant_id = ${id}`;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ reason: "requested", users_erased: 1 });
    // The history of program-owner actions says it happened, without the business's content.
    const pa = await h.ownerSql`select actor, detail from platform_audit where action = 'tenant.erased'`;
    expect(pa.at(-1)).toMatchObject({ actor: "boss@example.com", detail: { tenantId: id, accountsErased: 1 } });
  });

  it("a plain delete only hides the business: the data is still there for 30 days", async () => {
    const { id } = await makeBusiness("kept-30", "karl");
    expect((await del(id, "Biz kept-30")).body).toMatchObject({ erased: false });
    expect((await tenantRow(id))!.status).toBe("deleted");
    expect(await count("contacts", id)).toBe(1);
    expect(await listErasableBusinesses(h.db)).not.toContain(id);
    // ... and the database refuses to erase it early, even when asked directly.
    await expectRefused(eraseBusiness(h.db, id));
    expect(await count("contacts", id)).toBe(1);
  });

  it("only the program owner can delete or erase", async () => {
    const { id, owner } = await makeBusiness("not-yours", "nora");
    expect((await h.client(owner).post(`/platform/businesses/${id}/delete`, { confirmName: "Biz not-yours", erase: true })).status).toBe(403);
    expect((await del(id, "wrong name", true)).status).toBe(400);
    expect((await tenantRow(id))!.status).toBe("active");
    expect(await count("contacts", id)).toBe(1);
  });

  it("an active business can never be erased, however it is asked", async () => {
    const { id } = await makeBusiness("active-biz", "abel");
    await expectRefused(eraseBusiness(h.db, id, { now: true }));
    // Even with an old 'ended' date: it is still active.
    await h.ownerSql`update tenants set subscription_ended_at = now() - interval '200 days' where id = ${id}`;
    await expectRefused(eraseBusiness(h.db, id));
    expect(await listErasableBusinesses(h.db)).not.toContain(id);
  });

  it("the automatic run erases a business deleted 31 days ago but not one deleted 29 days ago", async () => {
    const old = await makeBusiness("old-del", "olaf");
    const recent = await makeBusiness("recent-del", "rita");
    await del(old.id, "Biz old-del"); await del(recent.id, "Biz recent-del");
    await h.ownerSql`update tenants set deleted_at = now() - interval '31 days' where id = ${old.id}`;
    await h.ownerSql`update tenants set deleted_at = now() - interval '29 days' where id = ${recent.id}`;
    const before = deletedAccounts.length;
    expect(await eraseDueBusinesses(h.db, identity, log)).toBe(1);
    expect(await tenantRow(old.id)).toBeUndefined();
    expect(await userExists("olaf@example.com")).toBe(false);
    expect(deletedAccounts.length).toBe(before + 1);
    expect(await tenantRow(recent.id)).toBeDefined();
    expect(await userExists("rita@example.com")).toBe(true);
    expect((await h.ownerSql`select reason from erasure_log where tenant_id = ${old.id}`)[0]).toMatchObject({ reason: "deleted" });
  });

  it("a cancelled subscription is erased 90 days after it ended, not before, and a paused business without one is never touched", async () => {
    const ended = await makeBusiness("ended-91", "emil");
    const fresh = await makeBusiness("ended-89", "eva");
    const manual = await makeBusiness("paused-manually", "mona");
    for (const b of [ended, fresh, manual]) await h.client(boss).post(`/platform/businesses/${b.id}/pause`, {});
    await h.ownerSql`update tenants set subscription_ended_at = now() - interval '91 days' where id = ${ended.id}`;
    await h.ownerSql`update tenants set subscription_ended_at = now() - interval '89 days' where id = ${fresh.id}`;
    expect(await eraseDueBusinesses(h.db, identity, log)).toBe(1);
    expect(await tenantRow(ended.id)).toBeUndefined();
    expect((await h.ownerSql`select reason from erasure_log where tenant_id = ${ended.id}`)[0]).toMatchObject({ reason: "subscription_ended" });
    expect(await tenantRow(fresh.id)).toBeDefined();
    expect(await tenantRow(manual.id)).toBeDefined();   // paused by hand: no countdown
  });

  it("keeps people who belong to another business, and program owners", async () => {
    const a = await makeBusiness("shared-a", "sven");
    const b = await makeBusiness("shared-b", "sofia");
    const sven = await h.token("sven");
    // sven also joins business B.
    await h.join(b.id, b.owner, sven, ["member"]);
    // the program owner is also a member of A.
    await h.join(a.id, a.owner, boss, ["member"]);
    const before = deletedAccounts.length;
    expect((await del(a.id, "Biz shared-a", true)).body.erased).toBe(true);
    expect(await userExists("sven@example.com")).toBe(true);      // still in business B
    expect(await userExists("boss@example.com")).toBe(true);      // a program owner
    expect(deletedAccounts.length).toBe(before);
    expect(await count("contacts", b.id)).toBe(1);                // B untouched
    expect((await h.client(sven, b.id).get("/contacts")).status).toBe(200);
  });

  it("webhook pauses start the 90-day countdown; paying again stops it", async () => {
    const { id } = await makeBusiness("countdown", "cleo");
    const { setBusinessStatus } = await import("@office/core");
    const actor = { userId: null, email: "stripe" };
    const meta = { requestId: "t" };
    await setBusinessStatus(h.db, actor, id, "suspended", meta, { subscriptionEnded: true });
    const started = new Date((await tenantRow(id))!.subscription_ended_at as unknown as string);
    expect(started.getTime()).toBeGreaterThan(0);
    await setBusinessStatus(h.db, actor, id, "suspended", meta, { subscriptionEnded: true });  // does not restart the clock
    expect(new Date((await tenantRow(id))!.subscription_ended_at as unknown as string).getTime()).toBe(started.getTime());
    await setBusinessStatus(h.db, actor, id, "active", meta);
    expect((await tenantRow(id))!.subscription_ended_at).toBeNull();
  });
});
