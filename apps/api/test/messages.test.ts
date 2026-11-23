import { afterAll, beforeAll, describe, expect, it } from "vitest";
import messages from "@office/module-messages";
import { setup } from "./harness.ts";

let h: Awaited<ReturnType<typeof setup>>;
let alice: string, bob: string, carol: string, dave: string, tA: string, tB: string;
let bobId: string, carolId: string, daveId: string;
const as = (tok: string) => h.client(tok, tA);
const M = "/m/messages";
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString("base64");

beforeAll(async () => {
  h = await setup([messages]);
  [alice, bob, carol, dave] = await Promise.all([h.token("alice"), h.token("bob"), h.token("carol"), h.token("dave")]);
  tA = (await h.client(alice).post("/tenants", { slug: "acme", name: "Acme" })).body.id;
  tB = (await h.client(dave).post("/tenants", { slug: "globex", name: "Globex" })).body.id;
  await h.join(tA, alice, bob, ["member"]);
  await h.join(tA, alice, carol, ["viewer"]);
  expect((await as(alice).post("/modules/messages/enable", {})).status).toBe(200);
  const people = (await as(alice).get(`${M}/people`)).body as { userId: string; name: string }[];
  bobId = people.find((p) => p.name === "bob")!.userId;
  carolId = people.find((p) => p.name === "carol")!.userId;
  await h.client(dave, tB).post("/modules/messages/enable", {});
  daveId = (await h.client(dave).get("/me")).body.userId;
});
afterAll(async () => { await h.teardown(); });

describe("messages module", () => {
  let direct: string, group: string, msgId: string;

  it("lists colleagues (not yourself); every role can chat", async () => {
    const people = (await as(alice).get(`${M}/people`)).body as { name: string }[];
    expect(people.map((p) => p.name)).toEqual(["bob", "carol"]);
    expect((await as(carol).get(`${M}/conversations`)).body).toEqual([]);
  });

  it("opens one direct chat per pair, whoever starts it", async () => {
    const a = await as(alice).post(`${M}/conversations/direct`, { userId: bobId });
    expect(a.status).toBe(200);
    direct = a.body.id;
    expect(a.body).toMatchObject({ kind: "direct", name: "bob", unread: 0, lastMessage: null });
    const b = await as(bob).post(`${M}/conversations/direct`, { userId: (a.body.members as { userId: string; me: boolean }[]).find((m) => m.me)!.userId });
    expect(b.body.id).toBe(direct);
    expect(b.body.name).toBe("alice");
    expect((await as(alice).post(`${M}/conversations/direct`, { userId: daveId })).status).toBe(400); // not in this business
  });

  it("sends messages, counts unread for the others, and marks them read", async () => {
    const r = await as(alice).post(`${M}/conversations/${direct}/messages`, { body: "  Hi Bob, can you cover Friday?  " });
    expect(r.status).toBe(201);
    msgId = r.body.id;
    expect(r.body).toMatchObject({ body: "Hi Bob, can you cover Friday?", mine: true, senderName: "alice" });
    expect((await as(alice).post(`${M}/conversations/${direct}/messages`, { body: "   " })).status).toBe(400);

    expect((await as(bob).get(`${M}/unread`)).body).toEqual({ count: 1, conversations: 1 });
    expect((await as(alice).get(`${M}/unread`)).body).toEqual({ count: 0, conversations: 0 });
    const list = (await as(bob).get(`${M}/conversations`)).body;
    expect(list[0]).toMatchObject({ id: direct, unread: 1, lastMessage: { preview: "Hi Bob, can you cover Friday?", mine: false } });

    const page = (await as(bob).get(`${M}/conversations/${direct}/messages`)).body;
    expect(page.data.map((m: { body: string }) => m.body)).toEqual(["Hi Bob, can you cover Friday?"]);
    await as(bob).post(`${M}/conversations/${direct}/read`, {});
    expect((await as(bob).get(`${M}/unread`)).body.count).toBe(0);
  });

  it("only the people in a chat can see it", async () => {
    expect((await as(carol).get(`${M}/conversations/${direct}`)).status).toBe(404);
    expect((await as(carol).get(`${M}/conversations/${direct}/messages`)).status).toBe(404);
    expect((await as(carol).post(`${M}/conversations/${direct}/messages`, { body: "hi" })).status).toBe(404);
    expect((await h.client(dave, tB).get(`${M}/conversations/${direct}`)).status).toBe(404);
  });

  it("polling returns new messages and ones edited or deleted since", async () => {
    const first = (await as(bob).get(`${M}/conversations/${direct}/messages`)).body;
    const reply = (await as(bob).post(`${M}/conversations/${direct}/messages`, { body: "Sure!" })).body;
    expect((await as(bob).patch(`/m/messages/messages/${msgId}`, { body: "hacked" })).status).toBe(403);
    expect((await as(alice).patch(`${M}/messages/${msgId}`, { body: "Hi Bob, can you cover Saturday?" })).body.editedAt).toBeTruthy();
    const poll = (await as(alice).get(`${M}/conversations/${direct}/messages?after=${msgId}&since=${encodeURIComponent(first.now)}`)).body;
    expect(poll.data.map((m: { id: string }) => m.id)).toEqual([reply.id]);
    expect(poll.changed.map((m: { body: string }) => m.body)).toEqual(["Hi Bob, can you cover Saturday?"]);

    expect((await as(alice).del(`${M}/messages/${msgId}`)).status).toBe(204);
    const after = (await as(bob).get(`${M}/conversations/${direct}/messages`)).body.data;
    expect(after[0]).toMatchObject({ id: msgId, body: "", deletedAt: expect.any(String) });
    expect((await as(alice).patch(`${M}/messages/${msgId}`, { body: "again" })).status).toBe(409);
  });

  it("sends files that only members can open; checks the file is what it says", async () => {
    const r = await as(alice).post(`${M}/conversations/${direct}/messages`, { file: { name: "rota.png", contentType: "image/png", data: png } });
    expect(r.status).toBe(201);
    expect(r.body.file).toMatchObject({ name: "rota.png", contentType: "image/png", sizeBytes: 11 });
    expect((await as(bob).get(`${M}/files/${r.body.file.id}`)).body.data).toBe(png);
    expect((await as(carol).get(`${M}/files/${r.body.file.id}`)).status).toBe(404);
    const fake = await as(alice).post(`${M}/conversations/${direct}/messages`, { file: { name: "x.pdf", contentType: "application/pdf", data: png } });
    expect(fake.status).toBe(400);
    expect((await as(alice).post(`${M}/conversations/${direct}/messages`, { file: { name: "x.html", contentType: "text/html", data: png } })).status).toBe(400);
  });

  it("creates a named group; anyone in it can rename it and add people", async () => {
    const r = await as(alice).post(`${M}/conversations/group`, { name: "Front desk", memberIds: [bobId] });
    expect(r.status).toBe(201);
    group = r.body.id;
    expect(r.body).toMatchObject({ kind: "group", name: "Front desk", myRole: "manager" });
    expect(r.body.members).toHaveLength(2);
    expect((await as(alice).post(`${M}/conversations/group`, { name: "  ", memberIds: [bobId] })).status).toBe(400);

    expect((await as(bob).patch(`${M}/conversations/${group}`, { name: "Reception team" })).body.name).toBe("Reception team");
    expect((await as(bob).patch(`${M}/conversations/${direct}`, { name: "Nope" })).status).toBe(400);
    const added = await as(bob).post(`${M}/conversations/${group}/members`, { userIds: [carolId] });
    expect(added.body.members.map((m: { name: string }) => m.name).sort()).toEqual(["alice", "bob", "carol"]);
    // Carol joins without a backlog of unread messages, and sees what happened.
    expect((await as(carol).get(`${M}/unread`)).body.count).toBe(0);
    const log = (await as(carol).get(`${M}/conversations/${group}/messages`)).body.data.map((m: { kind: string; body: string }) => `${m.kind}:${m.body}`);
    expect(log).toEqual(["system:alice created the group “Front desk” with bob", "system:bob renamed the group to “Reception team”", "system:bob added carol"]);
  });

  it("only the group manager removes people; anyone can leave; a manager always remains", async () => {
    expect((await as(bob).del(`${M}/conversations/${group}/members/${carolId}`)).status).toBe(403);
    const removed = await as(alice).del(`${M}/conversations/${group}/members/${carolId}`);
    expect(removed.body.members).toHaveLength(2);
    expect((await as(carol).get(`${M}/conversations/${group}`)).status).toBe(404);

    const aliceId = removed.body.members.find((m: { me: boolean }) => m.me).userId;
    expect((await as(alice).del(`${M}/conversations/${group}/members/${aliceId}`)).body).toEqual({ deleted: false, left: true });
    const g = (await as(bob).get(`${M}/conversations/${group}`)).body;
    expect(g).toMatchObject({ myRole: "manager", lastMessage: { preview: "alice left the group" } });
    expect((await as(bob).del(`${M}/conversations/${group}/members/${bobId}`)).body).toEqual({ deleted: true });
    expect((await as(bob).get(`${M}/conversations/${group}`)).status).toBe(404);
  });

  it("is off until the business adds the feature", async () => {
    const other = (await h.client(dave).post("/tenants", { slug: "initech", name: "Initech" })).body.id;
    expect((await h.client(dave, other).get(`${M}/conversations`)).status).toBe(403);
  });
});
