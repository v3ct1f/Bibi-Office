import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchEvent, InlineRunner, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import workmail, { configureWorkmail, fakeProvider, freePayments, type WorkmailPayments } from "@office/module-workmail";
import { setup } from "./harness.ts";

const provider = fakeProvider();
let h: Awaited<ReturnType<typeof setup>>;
let owner: string, member: string, memberUser: string, outsider: string, tA: string, tB: string;
let exec: ExecDeps;
const A = () => h.client(owner, tA);
const M = "/m/workmail";
const REG = { name: "Tribulis SL", email: "owner@tribulis.test", address: "Calle Mayor 1", city: "Madrid", postalCode: "28001", country: "es" };

const seen = new Set<string>();
async function pump(tenantId: string) {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tenantId)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
const types = async (tenantId: string) => (await h.events(tenantId)).map((e) => e.type).filter((t) => t.startsWith("workmail."));

beforeAll(async () => {
  h = await setup([workmail], { workmailProvider: provider });
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  [owner, member, outsider] = await Promise.all([h.token("olga"), h.token("max"), h.token("eve")]);
  tA = (await h.client(owner).post("/tenants", { slug: "tribulis", name: "Tribulis" })).body.id;
  tB = (await h.client(outsider).post("/tenants", { slug: "other", name: "Other" })).body.id;
  memberUser = (await h.client(member).get("/me")).body.userId;
  await h.join(tA, owner, member, ["member"]);
});
afterAll(async () => { await h.teardown(); });

describe("work email: domains", () => {
  let domainId: string;

  it("is off until the feature is turned on", async () => {
    expect((await A().get(`${M}/domains`)).status).toBe(403);
    expect((await A().post("/modules/workmail/enable", {})).status).toBe(200);
    expect((await A().get(`${M}/domains`)).body).toEqual([]);
    expect((await A().get(`${M}/config`)).body).toMatchObject({ available: true, hasDomain: false, maxMailboxes: 10 });
  });

  it("searches for a name and says what is free and what it costs", async () => {
    const r = (await A().get(`${M}/domains/search?q=tribulis`)).body as { domain: string; available: boolean; priceCents: number | null }[];
    expect(r[0]).toMatchObject({ domain: "tribulis.com", available: true, priceCents: 1900 });
    const taken = (await A().get(`${M}/domains/search?q=taken-name.com`)).body as { domain: string; available: boolean }[];
    expect(taken[0]).toMatchObject({ domain: "taken-name.com", available: false });
    expect((await A().get(`${M}/domains/search?q=x`)).status).toBe(400);
  });

  it("only people who manage domains can search or buy", async () => {
    const M2 = h.client(member, tA);
    expect((await M2.get(`${M}/domains/search?q=tribulis`)).status).toBe(403);
    expect((await M2.post(`${M}/domains/order`, { domain: "tribulis.com", registrant: REG })).status).toBe(403);
  });

  it("won't buy a name that isn't free, or ask the browser for the price", async () => {
    expect((await A().post(`${M}/domains/order`, { domain: "taken-name.com", registrant: REG })).status).toBe(409);
    expect((await A().post(`${M}/domains/order`, { domain: "not a domain", registrant: REG })).status).toBe(400);
    expect((await A().post(`${M}/domains/order`, { domain: "tribulis.com", registrant: { ...REG, country: "Spain" } })).status).toBe(400);
    expect((await A().post(`${M}/domains/order`, { domain: "tribulis.com", registrant: REG, priceCents: 1 })).status).toBe(400);
  });

  it("buys a domain in the business's name and sets up its mail records", async () => {
    const r = await A().post(`${M}/domains/order`, { domain: "Tribulis.com", registrant: REG });
    expect(r.status).toBe(201);
    expect(r.body.redirectUrl).toBeNull();
    domainId = r.body.domain.id;
    expect(r.body.domain).toMatchObject({ name: "tribulis.com", source: "bought", status: "active", priceCents: 1900, currency: "EUR", transferable: true, registrant: { name: "Tribulis SL" } });
    const call = provider.calls.find((c) => c.op === "registerDomain")!.args as { registrant: { country: string; name: string } };
    expect(call.registrant).toMatchObject({ name: "Tribulis SL", country: "ES" });
    expect(await types(tA)).toContain("workmail.domain.registered");
    expect((await A().get(`${M}/config`)).body.hasDomain).toBe(true);
    const audit = await h.asOwner(tA, (tx) => tx`select action from audit_log where action = 'workmail.domain.bought'`);
    expect(audit.length).toBe(1);
  });

  it("a name already bought can't be bought again, by anyone", async () => {
    expect((await A().post(`${M}/domains/order`, { domain: "tribulis.com", registrant: REG })).status).toBe(409);
    await h.client(outsider, tB).post("/modules/workmail/enable", {});
    expect((await h.client(outsider, tB).post(`${M}/domains/order`, { domain: "tribulis.com", registrant: REG })).status).toBe(409);
  });

  it("another business sees none of it", async () => {
    expect((await h.client(outsider, tB).get(`${M}/domains`)).body).toEqual([]);
    expect((await h.client(outsider, tB).post(`${M}/domains/${domainId}/transfer-out`, {})).status).toBe(404);
  });

  it("refuses the transfer code during the first 60 days, then gives it", async () => {
    const early = await A().post(`${M}/domains/${domainId}/transfer-out`, {});
    expect(early.status).toBe(409);
    expect(early.body.title).toMatch(/after 60 days/);
    await h.asOwner(tA, (tx) => tx`update workmail_domains set registered_at = now() - interval '61 days' where id = ${domainId}`);
    const r = await A().post(`${M}/domains/${domainId}/transfer-out`, {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ domain: "tribulis.com" });
    expect(r.body.code).toMatch(/^AUTH-/);
    const audit = await h.asOwner(tA, (tx) => tx`select action from audit_log where action = 'workmail.domain.transfer_code_shown'`);
    expect(audit.length).toBe(1);
  });

  it("removing a domain needs its name typed, and the right to manage features", async () => {
    const wrong = await A().post(`${M}/domains/${domainId}/remove`, { confirm: "nope.com" });
    expect(wrong.status).toBe(400);
    expect((await A().post(`${M}/domains/${domainId}/remove`, {})).status).toBe(400);
    expect((await h.client(member, tA).post(`${M}/domains/${domainId}/remove`, { confirm: "tribulis.com" })).status).toBe(403);
    // Nothing happened.
    expect((await A().get(`${M}/domains`)).body.find((d: { id: string }) => d.id === domainId).status).toBe("active");
  });

  it("connects a domain the business already owns: shows the records, then checks them", async () => {
    const c = await A().post(`${M}/domains/connect`, { domain: "mycafe.example" });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name: "mycafe.example", source: "connected", status: "dns_pending", transferable: false });
    expect(c.body.records.map((r: { type: string }) => r.type)).toEqual(["MX", "TXT", "CNAME"]);
    const no = await A().post(`${M}/domains/${c.body.id}/check`, {});
    expect(no.body.ok).toBe(false);
    expect(no.body.missing.length).toBe(3);
    expect((await A().get(`${M}/domains`)).body.find((d: { name: string }) => d.name === "mycafe.example").status).toBe("dns_pending");
    // A mailbox can't be made on a domain that isn't ready.
    expect((await A().post(`${M}/mailboxes`, { domainId: c.body.id, localPart: "anna", name: "Anna" })).status).toBe(409);
    provider.setDnsOk("mycafe.example");
    const yes = await A().post(`${M}/domains/${c.body.id}/check`, {});
    expect(yes.body).toMatchObject({ ok: true, missing: [], domain: { status: "active" } });
    // Their own registrar holds it, so there's no code from us.
    expect((await A().post(`${M}/domains/${c.body.id}/transfer-out`, {})).status).toBe(400);
    // It can be taken off the list (no mailboxes here: nothing to switch off).
    const gone = await A().post(`${M}/domains/${c.body.id}/remove`, { confirm: "MyCafe.example" });
    expect(gone.status).toBe(200);
    expect(gone.body).toMatchObject({ domain: "mycafe.example", source: "connected", mailboxesSwitchedOff: 0, keptUntil: null });
    expect((await A().get(`${M}/domains`)).body.map((d: { name: string }) => d.name)).toEqual(["tribulis.com"]);
  });

  it("a connected domain whose records are already in place becomes ready at once", async () => {
    const c = await A().post(`${M}/domains/connect`, { domain: "dns-ok-shop.example" });
    const ok = await A().post(`${M}/domains/${c.body.id}/check`, {});
    expect(ok.body.ok).toBe(true);
    expect((await A().post(`${M}/domains/${c.body.id}/remove`, { confirm: "dns-ok-shop.example" })).status).toBe(200);
  });

  it("explains a provider failure instead of crashing, and keeps the order to retry", async () => {
    provider.failNext("registerDomain");
    const r = await A().post(`${M}/domains/order`, { domain: "retry-me.com", registrant: REG });
    expect(r.status).toBe(424);
    expect(r.body.title).toMatch(/Nothing is lost/);
    const rows = (await A().get(`${M}/domains`)).body as { id: string; name: string; status: string; lastError: string }[];
    const pending = rows.find((d) => d.name === "retry-me.com")!;
    expect(pending).toMatchObject({ status: "awaiting_payment" });
    expect(pending.lastError).toMatch(/told to fail/);
    const again = await A().post(`${M}/domains/${pending.id}/confirm`, {});
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("active");
  });
});

describe("work email: paying for a domain", () => {
  const paid = new Set<string>();
  const charges: { orderId: string; amountCents: number; returnPath: string }[] = [];
  const payments: WorkmailPayments = {
    async chargeDomain(i) { charges.push(i); return { status: "redirect", url: `https://pay.test/${i.orderId}`, ref: `pay_${i.orderId}` }; },
    async isPaid(ref) { return paid.has(ref); },
  };
  beforeAll(() => configureWorkmail({ payments }));
  afterAll(() => configureWorkmail({ payments: freePayments }));

  it("sends the owner to pay, registers nothing until paid, then finishes", async () => {
    const before = provider.calls.filter((c) => c.op === "registerDomain").length;
    const r = await A().post(`${M}/domains/order`, { domain: "paidfirst.com", registrant: REG, returnPath: "/t/tribulis/m/workmail/email" });
    expect(r.status).toBe(201);
    expect(r.body.redirectUrl).toMatch(/^https:\/\/pay\.test\//);
    expect(r.body.domain.status).toBe("awaiting_payment");
    expect(charges.at(-1)).toMatchObject({ amountCents: 1900, returnPath: `/t/tribulis/m/workmail/email?order=${r.body.domain.id}` });
    expect(provider.calls.filter((c) => c.op === "registerDomain").length).toBe(before);

    const id = r.body.domain.id as string;
    const notYet = await A().post(`${M}/domains/${id}/confirm`, {});
    expect(notYet.status).toBe(402);
    expect(provider.calls.filter((c) => c.op === "registerDomain").length).toBe(before);

    paid.add(`pay_${id}`);
    const done = await A().post(`${M}/domains/${id}/confirm`, {});
    expect(done.body).toMatchObject({ status: "active", name: "paidfirst.com" });
    // Confirming again does not register twice.
    expect((await A().post(`${M}/domains/${id}/confirm`, {})).status).toBe(200);
    expect(provider.calls.filter((c) => c.op === "registerDomain").length).toBe(before + 1);
  });

  it("an abandoned order can be started again", async () => {
    const a = await A().post(`${M}/domains/order`, { domain: "abandoned.com", registrant: REG });
    const b = await A().post(`${M}/domains/order`, { domain: "abandoned.com", registrant: REG });
    expect(b.status).toBe(201);
    expect(b.body.domain.id).not.toBe(a.body.domain.id);
    expect(((await A().get(`${M}/domains`)).body as { name: string }[]).filter((d) => d.name === "abandoned.com").length).toBe(1);
  });

  it("only accepts a return path inside the app", async () => {
    expect((await A().post(`${M}/domains/order`, { domain: "evil.com", registrant: REG, returnPath: "https://evil.test/" })).status).toBe(400);
    expect((await A().post(`${M}/domains/order`, { domain: "evil.com", registrant: REG, returnPath: "//evil.test/" })).status).toBe(400);
  });
});

describe("work email: mailboxes", () => {
  let domainId: string, boxId: string;
  beforeAll(async () => { domainId = ((await A().get(`${M}/domains`)).body as { id: string; name: string }[]).find((d) => d.name === "tribulis.com")!.id; });

  it("creates anna@tribulis.com for a colleague and shows the password once", async () => {
    const r = await A().post(`${M}/mailboxes`, { domainId, localPart: "Anna", name: "Anna Ruiz", userId: memberUser });
    expect(r.status).toBe(201);
    boxId = r.body.id;
    expect(r.body).toMatchObject({ address: "anna@tribulis.com", name: "Anna Ruiz", status: "active", userId: memberUser });
    expect(r.body.password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    expect(r.body.webmailUrl).toContain("webmail.fake-mail.test");
    const stored = [...provider.mailboxes.values()].find((m) => m.address === "anna@tribulis.com")!;
    expect(stored.password).toBe(r.body.password);
    // Office doesn't keep the password anywhere.
    const rows = await h.asOwner(tA, (tx) => tx`select * from workmail_mailboxes where id = ${boxId}`);
    expect(JSON.stringify(rows)).not.toContain(r.body.password);
    expect(JSON.stringify((await A().get(`${M}/mailboxes`)).body)).not.toContain(r.body.password);
    expect(await types(tA)).toContain("workmail.mailbox.created");
  });

  it("refuses the same address twice, bad names, and people who aren't members", async () => {
    expect((await A().post(`${M}/mailboxes`, { domainId, localPart: "anna", name: "Other Anna" })).status).toBe(409);
    expect((await A().post(`${M}/mailboxes`, { domainId, localPart: "bad name", name: "X" })).status).toBe(400);
    expect((await A().post(`${M}/mailboxes`, { domainId, localPart: "ghost", name: "X", userId: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
    expect((await A().post(`${M}/mailboxes`, { domainId: "00000000-0000-4000-8000-000000000000", localPart: "x", name: "X" })).status).toBe(404);
  });

  it("members see only their own mailbox and can't manage any", async () => {
    await A().post(`${M}/mailboxes`, { domainId, localPart: "info", name: "Info" });
    const mine = (await h.client(member, tA).get(`${M}/mailboxes`)).body as { address: string }[];
    expect(mine.map((m) => m.address)).toEqual(["anna@tribulis.com"]);
    expect((await A().get(`${M}/mailboxes`)).body.length).toBe(2);
    expect((await h.client(member, tA).post(`${M}/mailboxes`, { domainId, localPart: "me", name: "Me" })).status).toBe(403);
  });

  it("switches a mailbox off and on, resets its password, and deletes it", async () => {
    const off = await A().post(`${M}/mailboxes/${boxId}/suspend`, {});
    expect(off.body).toMatchObject({ status: "suspended", suspendReason: "by_hand" });
    expect([...provider.mailboxes.values()].find((m) => m.address === "anna@tribulis.com")!.active).toBe(false);
    expect((await A().post(`${M}/mailboxes/${boxId}/reset-password`, {})).status).toBe(409);
    expect((await A().post(`${M}/mailboxes/${boxId}/resume`, {})).body.status).toBe("active");
    const pw = await A().post(`${M}/mailboxes/${boxId}/reset-password`, {});
    expect(pw.body.password).toMatch(/^[A-Za-z0-9-]{14}$/);
    expect([...provider.mailboxes.values()].find((m) => m.address === "anna@tribulis.com")!.password).toBe(pw.body.password);

    const tmp = await A().post(`${M}/mailboxes`, { domainId, localPart: "temp", name: "Temp" });
    expect((await A().del(`${M}/mailboxes/${tmp.body.id}`)).status).toBe(204);
    expect([...provider.mailboxes.values()].find((m) => m.address === "temp@tribulis.com")!.deleted).toBe(true);
    // The address can be used again.
    expect((await A().post(`${M}/mailboxes`, { domainId, localPart: "temp", name: "Temp 2" })).status).toBe(201);
  });

  it("removing the colleague switches their mailbox off", async () => {
    const members = (await A().get("/members")).body as { id: string; userId: string }[];
    const mid = members.find((m) => m.userId === memberUser)!.id;
    expect((await A().del(`/members/${mid}`)).status).toBe(204);
    await pump(tA);
    const box = ((await A().get(`${M}/mailboxes`)).body as { id: string; status: string; suspendReason: string }[]).find((b) => b.id === boxId)!;
    expect(box).toMatchObject({ status: "suspended", suspendReason: "colleague_removed" });
    expect([...provider.mailboxes.values()].find((m) => m.address === "anna@tribulis.com")!.active).toBe(false);
    // The colleague's mailbox isn't deleted: the owner can still decide what to do with it.
    expect(provider.mailboxes.get([...provider.mailboxes.entries()].find(([, m]) => m.address === "anna@tribulis.com")![0])!.deleted).toBe(false);
    // The unrelated mailbox is untouched.
    expect(((await A().get(`${M}/mailboxes`)).body as { address: string; status: string }[]).find((b) => b.address === "info@tribulis.com")!.status).toBe("active");
  });

  it("stops at the most mailboxes this business can have", async () => {
    await A().patch("/modules/workmail/settings", { maxMailboxes: 3 });
    const n = ((await A().get(`${M}/mailboxes`)).body as unknown[]).length;
    for (let i = n; i < 3; i++) expect((await A().post(`${M}/mailboxes`, { domainId, localPart: `fill${i}`, name: "Fill" })).status).toBe(201);
    const r = await A().post(`${M}/mailboxes`, { domainId, localPart: "onetoomany", name: "Too many" });
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/up to 3 work mailboxes/);
  });



  it("turning the feature off pauses mail, turning it on resumes it; nothing is deleted", async () => {
    const active = () => [...provider.mailboxes.values()].filter((m) => !m.deleted && m.active).length;
    const before = active();
    expect(before).toBeGreaterThan(0);
    expect((await A().post("/modules/workmail/disable", {})).status).toBe(200);
    expect(active()).toBe(0);
    expect((await A().post("/modules/workmail/enable", {})).status).toBe(200);
    // Back on: the ones that were paused because of the feature come back; the colleague's stays off.
    expect(active()).toBe(before);
    const rows = await h.asOwner(tA, (tx) => tx`select count(*)::int as n from workmail_mailboxes where status <> 'deleted'`);
    expect(rows[0]!.n).toBeGreaterThan(0);
  });
});

describe("work email: removing a domain", () => {
  const used = async () => (await A().get(`${M}/config`)).body.mailboxesUsed as number;

  it("a connected domain is disconnected; its mailboxes are switched off, mail kept, no longer billed", async () => {
    await A().patch("/modules/workmail/settings", { maxMailboxes: 50 });
    const c = await A().post(`${M}/domains/connect`, { domain: "dns-ok-two.example" });
    await A().post(`${M}/domains/${c.body.id}/check`, {});
    const hi = await A().post(`${M}/mailboxes`, { domainId: c.body.id, localPart: "hi", name: "Hi" });
    expect(hi.status).toBe(201);
    const before = await used();
    const listed = (await A().get(`${M}/domains`)).body.find((d: { id: string }) => d.id === c.body.id);
    expect(listed.mailboxes).toBe(1);

    const r = await A().post(`${M}/domains/${c.body.id}/remove`, { confirm: "dns-ok-two.example" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ domain: "dns-ok-two.example", source: "connected", mailboxesSwitchedOff: 1, keptUntil: null });

    // Gone from the list; the mailbox still exists (mail kept) but is off, and can't be switched back on.
    expect((await A().get(`${M}/domains`)).body.some((d: { id: string }) => d.id === c.body.id)).toBe(false);
    const box = (await A().get(`${M}/mailboxes`)).body.find((m: { id: string }) => m.id === hi.body.id);
    expect(box).toMatchObject({ status: "suspended", suspendReason: "domain_removed" });
    expect([...provider.mailboxes.values()].find((m) => m.address === "hi@dns-ok-two.example")).toMatchObject({ active: false, deleted: false });
    const back = await A().post(`${M}/mailboxes/${hi.body.id}/resume`, {});
    expect(back.status).toBe(409);
    expect(back.body.title).toMatch(/domain was removed/);
    // Billing: one mailbox fewer.
    expect(await used()).toBe(before - 1);
    // Recorded, and announced through the event system.
    await pump(tA);
    expect(await types(tA)).toContain("workmail.domain.removed");
    const audit = await h.asOwner(tA, (tx) => tx`select action from audit_log where action = 'workmail.domain.removed'`);
    expect(audit.length).toBeGreaterThan(0);
    // Removing it twice isn't possible.
    expect((await A().post(`${M}/domains/${c.body.id}/remove`, { confirm: "dns-ok-two.example" })).status).toBe(404);
  });

  it("a bought domain stays registered to the business until it expires (not renewed) and can still be moved away", async () => {
    const o = await A().post(`${M}/domains/order`, { domain: "keepsake.com", registrant: REG });
    expect(o.status).toBe(201);
    const id = o.body.domain.id as string;
    const r = await A().post(`${M}/domains/${id}/remove`, { confirm: "keepsake.com" });
    expect(r.status).toBe(200);
    expect(r.body.keptUntil).toBeTruthy();
    expect(r.body.transferFrom).toBeTruthy();
    const listed = (await A().get(`${M}/domains`)).body.find((d: { id: string }) => d.id === id);
    expect(listed).toMatchObject({ status: "removed", transferable: true });
    expect(listed.removedAt).toBeTruthy();
    // No new mailboxes on it, but the transfer code still works after the 60-day lock.
    expect((await A().post(`${M}/mailboxes`, { domainId: id, localPart: "x", name: "X" })).status).toBeGreaterThanOrEqual(400);
    await h.asOwner(tA, (tx) => tx`update workmail_domains set registered_at = now() - interval '61 days' where id = ${id}`);
    expect((await A().post(`${M}/domains/${id}/transfer-out`, {})).status).toBe(200);
  });
});

describe("work email: not set up", () => {
  it("says so plainly when the server has no provider", async () => {
    configureWorkmail({ provider: null });
    try {
      expect((await A().get(`${M}/config`)).body.available).toBe(false);
      const r = await A().get(`${M}/domains/search?q=tribulis`);
      expect(r.status).toBe(424);
      expect(r.body.title).toMatch(/isn't set up/);
    } finally { configureWorkmail({ provider }); }
  });
});
