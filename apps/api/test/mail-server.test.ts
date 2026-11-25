/**
 * Mail with a REAL mail server (in-memory IMAP + SMTP): fetching in the worker's job, two-way sync, linking mailboxes made
 * before Mail was on, storage limit and the Trash clean-up. Office signs in as a master user, never with the person's password.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { dispatchEvent, InlineRunner, runDueJobs, type ExecDeps } from "@office/platform";
import type { EventEnvelope } from "@office/sdk";
import workmail, { fakeProvider } from "@office/module-workmail";
import mail, { configureMail, DEFAULT_QUOTA_BYTES, imapMailProvider, masterLogin } from "@office/module-mail";
import { email, startMailServers } from "../../../modules/support/tests/mail-servers.ts";
import { setup } from "./harness.ts";

const MASTER = "master-secret";
const MAX = "max@tribulis.com";
let servers: Awaited<ReturnType<typeof startMailServers>>;
let h: Awaited<ReturnType<typeof setup>>;
let relay: postgres.Sql;
let exec: ExecDeps;
let owner: string, member: string, memberUser: string, ownerUser: string, tA: string;
const A = () => h.client(owner, tA);
const Mx = () => h.client(member, tA);
const W = "/m/workmail", M = "/m/mail";

const seen = new Set<string>();
async function pump() {
  const runner = new InlineRunner(exec, 1);
  for (let i = 0; i < 20; i++) {
    const evs = (await h.events(tA)).filter((e) => !seen.has(e.id));
    if (!evs.length) break;
    for (const e of evs) { seen.add(e.id); await dispatchEvent({ ...exec, runner }, e as EventEnvelope).catch(() => {}); }
  }
}
/** What the worker does every minute. */
async function runJobs() {
  await relay`update module_job_state set next_run_at = now()`;
  await runDueJobs(relay, { db: h.db, registry: h.registry, secrets: h.secrets });
}
type Thread = { id: string; messageId: string; subject: string; unread: number; isStarred: boolean };
const inbox = async (folder = "inbox") => ((await Mx().get(`${M}/threads?folder=${folder}`)).body as { data: Thread[] }).data;
const box = (path: string) => servers.imap.getMailbox(path)?.messages ?? [];
const asMax = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
  h.asOwner(tA, async (tx) => { await tx`select set_config('app.mail_user', ${memberUser}, true)`; return fn(tx); });

beforeAll(async () => {
  servers = await startMailServers({ user: `${MAX}*office`, pass: MASTER });
  const provider = imapMailProvider({
    imap: { host: "127.0.0.1", port: servers.imapPort, security: "none" }, smtp: { host: "127.0.0.1", port: servers.smtpPort, security: "none" },
    login: masterLogin("{address}*{master}", "office", MASTER),
  });
  h = await setup([workmail, mail], { workmailProvider: fakeProvider(), mailProvider: provider });
  relay = postgres(h.tdb.relayUrl, { onnotice: () => {} });
  exec = { db: h.db, registry: h.registry, secrets: h.secrets, http: { allowPrivate: true, requireHttps: false } };
  [owner, member] = await Promise.all([h.token("olga"), h.token("max")]);
  tA = (await h.client(owner).post("/tenants", { slug: "tribulis", name: "Tribulis" })).body.id;
  await h.join(tA, owner, member, ["member"]);
  memberUser = (await h.client(member).get("/me")).body.userId;
  ownerUser = (await h.client(owner).get("/me")).body.userId;
});
afterAll(async () => { await relay.end(); await servers.stop(); await h.teardown(); });

describe("mail with a real mail server", () => {
  it("links work mailboxes that were made before Mail was turned on (switched-off ones stay off)", async () => {
    await A().post("/modules/workmail/enable", {});
    const reg = { name: "Tribulis SL", email: "o@tribulis.test", address: "Calle Mayor 1", city: "Madrid", postalCode: "28001", country: "ES" };
    const d = (await A().post(`${W}/domains/order`, { domain: "tribulis.com", registrant: reg })).body.domain;
    expect((await A().post(`${W}/mailboxes`, { domainId: d.id, localPart: "max", name: "Max", userId: memberUser })).status).toBe(201);
    const olga = (await A().post(`${W}/mailboxes`, { domainId: d.id, localPart: "olga", name: "Olga", userId: ownerUser })).body;
    await A().post(`${W}/mailboxes/${olga.id}/suspend`, {});
    await pump(); // Mail is off: nobody listens yet

    expect((await A().post("/modules/mail/enable", {})).status).toBe(200);
    await pump();
    const acc = (await Mx().get(`${M}/account`)).body;
    expect(acc).toMatchObject({ available: true, background: true, account: { address: MAX, source: "workmail", status: "active" } });
    expect(acc.storage).toMatchObject({ usedBytes: 0, quotaBytes: DEFAULT_QUOTA_BYTES, full: false });
    expect((await A().get(`${M}/account`)).body.account).toMatchObject({ address: "olga@tribulis.com", status: "paused" });
    // A person can ask again themselves ("Link my work mailbox").
    expect((await Mx().post(`${M}/account/link`, {})).body).toEqual({ requested: true });
    await pump();
    expect((await Mx().get(`${M}/account`)).body.account.address).toBe(MAX);
  });

  it("fetches new mail in the worker's job, not when the page asks", async () => {
    servers.deliver(email({ from: "carla@client.test", fromName: "Carla", to: MAX, subject: "Quote for 40 units", body: "Hi Max" }));
    servers.deliver(email({ from: "dan@client.test", fromName: "Dan", to: MAX, subject: "Lunch on Friday?", body: "?" }));
    expect((await Mx().get(`${M}/unread`)).body.count).toBe(0);
    expect((await Mx().post(`${M}/sync`, {})).body).toMatchObject({ received: 0, background: true });
    expect(await inbox()).toEqual([]);
    await runJobs();
    expect((await inbox()).map((t) => t.subject).sort()).toEqual(["Lunch on Friday?", "Quote for 40 units"]);
    expect((await Mx().get(`${M}/unread`)).body.count).toBe(2);
    expect((await Mx().get(`${M}/account`)).body.account).toMatchObject({ lastSyncedAt: expect.any(String), lastSyncError: null });
    await runJobs();
    expect(await inbox()).toHaveLength(2); // nothing twice
  });

  it("writes read, star and archive back to the mail server", async () => {
    const t = await inbox();
    const quote = t.find((x) => x.subject.startsWith("Quote"))!, lunch = t.find((x) => x.subject.startsWith("Lunch"))!;
    await Mx().post(`${M}/threads/action`, { ids: [quote.id], action: "read" });
    await Mx().post(`${M}/threads/action`, { ids: [quote.id], action: "star" });
    await Mx().post(`${M}/threads/action`, { ids: [lunch.id], action: "archive" });
    expect(box("INBOX")).toHaveLength(2); // not yet: the job writes it
    await runJobs();
    expect(box("INBOX")).toHaveLength(1);
    expect(box("INBOX")[0]!.flags).toEqual(expect.arrayContaining(["\\Seen", "\\Flagged"]));
    expect(box("Archive")).toHaveLength(1);
    const dirty = await asMax((tx) => tx`select count(*)::int as n from mail_messages where remote_dirty`);
    expect(dirty[0]!.n).toBe(0);
  });

  it("shows what another mail app changed (read on a phone)", async () => {
    const m = box("INBOX")[0]!;
    m.flags = m.flags.filter((f) => f !== "\\Seen"); // marked unread elsewhere
    await runJobs();
    expect((await inbox())[0]).toMatchObject({ subject: "Quote for 40 units", unread: 1, isStarred: true });
  });

  it("deletes for good on the server too", async () => {
    const lunch = (await inbox("archive"))[0]!;
    await Mx().post(`${M}/threads/action`, { ids: [lunch.id], action: "trash" });
    await Mx().post(`${M}/threads/action`, { ids: [lunch.id], action: "delete" });
    await runJobs();
    expect(box("Archive")).toHaveLength(0);
    expect(box("Trash")).toHaveLength(0);
    const left = await asMax((tx) => tx`select count(*)::int as n from mail_remote_deletions`);
    expect(left[0]!.n).toBe(0);
  });

  it("sends over SMTP and keeps the copy in the server's Sent folder", async () => {
    const d = (await Mx().post(`${M}/drafts`, { to: [{ name: "Carla", email: "carla@client.test" }], subject: "Your quote", text: "Attached." })).body;
    const sent = await Mx().post(`${M}/drafts/${d.id}/send`, {});
    expect(sent.status).toBe(200);
    const got = await servers.waitForSent(1);
    expect(got[0]!.to).toEqual(["carla@client.test"]);
    expect(got[0]!.mail.subject).toBe("Your quote");
    expect(got[0]!.mail.from?.value[0]?.address).toBe(MAX);
    expect(box("Sent")).toHaveLength(1);
    const row = await asMax((tx) => tx`select remote_uid from mail_messages where id = ${d.id}`);
    expect(row[0]!.remote_uid).toMatch(/:Sent$/);
  });

  it("a full mailbox stops receiving and sending, and says why", async () => {
    configureMail({ quotaBytes: 10 });
    expect((await Mx().get(`${M}/account`)).body.storage.full).toBe(true);
    const d = (await Mx().post(`${M}/drafts`, { to: [{ name: "", email: "carla@client.test" }], subject: "x", text: "x" })).body;
    const r = await Mx().post(`${M}/drafts/${d.id}/send`, {});
    expect(r.status).toBe(409);
    expect(r.body.title).toMatch(/mailbox is full/);
    servers.deliver(email({ from: "erin@client.test", to: MAX, subject: "Waiting on the server", body: "hi" }));
    await runJobs();
    expect((await Mx().get(`${M}/account`)).body.account.lastSyncError).toMatch(/mailbox is full/);
    expect((await inbox()).map((t) => t.subject)).not.toContain("Waiting on the server");
    configureMail({ quotaBytes: DEFAULT_QUOTA_BYTES });
    await runJobs(); // nothing was lost: it comes in once there is room
    expect((await inbox()).map((t) => t.subject)).toContain("Waiting on the server");
    await Mx().del(`${M}/drafts/${d.id}`);
  });

  it("empties Trash and Spam after 30 days, on the server too", async () => {
    const t = (await inbox()).find((x) => x.subject === "Waiting on the server")!;
    await Mx().post(`${M}/threads/action`, { ids: [t.id], action: "trash" });
    await runJobs();
    expect(box("Trash")).toHaveLength(1);
    await asMax((tx) => tx`update mail_messages set trashed_at = now() - interval '29 days' where folder = 'trash'`);
    await runJobs();
    expect((await inbox("trash")).length).toBe(1); // not yet
    await asMax((tx) => tx`update mail_messages set trashed_at = now() - interval '31 days' where folder = 'trash'`);
    await runJobs(); // the clean-up deletes it here...
    expect(await inbox("trash")).toEqual([]);
    await runJobs(); // ...and the next fetch deletes it on the server
    expect(box("Trash")).toHaveLength(0);
  });

  it("keeps no mailbox password, and the new table is private to the person too", async () => {
    const cols = await h.ownerSql`select table_name, column_name from information_schema.columns where table_name like 'mail\\_%' and column_name ilike '%pass%'`;
    expect(cols).toEqual([]);
    const [t] = await h.ownerSql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'mail_remote_deletions'`;
    expect(t).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    const seenByOlga = await h.asOwner(tA, async (tx) => { await tx`select set_config('app.mail_user', ${ownerUser}, true)`; return tx`select count(*)::int as n from mail_messages`; });
    expect(seenByOlga[0]!.n).toBe(0);
  });
});
