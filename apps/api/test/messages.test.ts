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

describe("WhatsApp-style extras", () => {
  let chat: string;
  const send = (tok: string, body: object) => as(tok).post(`${M}/conversations/${chat}/messages`, body);
  const last = async (tok: string) => (await as(tok).get(`${M}/conversations`)).body.find((c: { id: string }) => c.id === chat).lastMessage.preview;

  beforeAll(async () => {
    chat = (await as(alice).post(`${M}/conversations/group`, { name: "Extras", memberIds: [bobId, carolId] })).body.id;
  });

  it("uploads a big video in parts, then sends it; members can download each part", async () => {
    const size = 4 * 1024 * 1024 + 1000;
    const bytes = Buffer.alloc(size, 7);
    bytes.write("\0\0\0\x18ftypmp42", 0, "latin1");
    const up = await as(alice).post(`${M}/conversations/${chat}/uploads`, { name: "tour.mp4", contentType: "video/mp4", sizeBytes: size });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ partCount: 2, partSize: 4 * 1024 * 1024 });
    const part = (i: number) => bytes.subarray(i * up.body.partSize, (i + 1) * up.body.partSize).toString("base64");
    expect((await as(alice).put(`${M}/uploads/${up.body.id}/parts/0`, { data: part(0) })).status).toBe(200);
    // Not finished yet.
    expect((await send(alice, { kind: "text", fileId: up.body.id })).status).toBe(400);
    expect((await as(bob).put(`${M}/uploads/${up.body.id}/parts/1`, { data: part(1) })).status).toBe(404); // not bob's upload
    expect((await as(alice).put(`${M}/uploads/${up.body.id}/parts/1`, { data: Buffer.alloc(10).toString("base64") })).status).toBe(400); // wrong size
    expect((await as(alice).put(`${M}/uploads/${up.body.id}/parts/1`, { data: part(1) })).status).toBe(200);
    const sent = await send(alice, { kind: "text", body: "The house tour", fileId: up.body.id });
    expect(sent.status).toBe(201);
    expect(sent.body.file).toMatchObject({ name: "tour.mp4", contentType: "video/mp4", sizeBytes: size, partCount: 2 });
    expect((await send(alice, { kind: "text", fileId: up.body.id })).status).toBe(409); // can't send twice
    const p1 = (await as(bob).get(`${M}/files/${up.body.id}?part=1`)).body;
    expect(Buffer.from(p1.data, "base64").length).toBe(1000);
    expect((await h.client(dave, tB).get(`${M}/files/${up.body.id}`)).status).toBe(404);

    const fake = await as(alice).post(`${M}/conversations/${chat}/uploads`, { name: "x.mp4", contentType: "video/mp4", sizeBytes: 10 });
    expect((await as(alice).put(`${M}/uploads/${fake.body.id}/parts/0`, { data: Buffer.from("helloworld").toString("base64") })).status).toBe(400);
    expect((await as(alice).post(`${M}/conversations/${chat}/uploads`, { name: "big.mp4", contentType: "video/mp4", sizeBytes: 17 * 1024 * 1024 })).status).toBe(400);
  });

  it("voice messages are audio files marked as voice", async () => {
    const ogg = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(40, 1)]).toString("base64");
    const r = await send(bob, { kind: "text", file: { name: "voice.ogg", contentType: "audio/ogg", data: ogg }, voice: { durationMs: 4200 } });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ voice: true, durationMs: 4200 });
    expect(await last(alice)).toBe("🎤 Voice message");
    expect((await send(bob, { kind: "text", body: "hi", voice: { durationMs: 1 } })).status).toBe(400);
    expect((await as(bob).patch(`${M}/messages/${r.body.id}`, { body: "text" })).status).toBe(400);
  });

  it("polls: one or several answers, votes can change, everyone sees the counts", async () => {
    const r = await send(alice, { kind: "poll", question: "Team lunch?", options: ["Pizza", "Sushi", "Tacos"] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ question: "Team lunch?", multiple: false, voters: 0 });
    const pollId = r.body.id;
    expect(await last(bob)).toBe("📊 Poll: Team lunch?");
    expect((await send(alice, { kind: "poll", question: "?", options: ["only one"] })).status).toBe(400);

    const before = (await as(alice).get(`${M}/conversations/${chat}/messages`)).body.now;
    expect((await as(bob).post(`${M}/messages/${pollId}/vote`, { optionIds: ["1", "2"] })).status).toBe(400); // single choice
    await as(bob).post(`${M}/messages/${pollId}/vote`, { optionIds: ["2"] });
    const v = (await as(carol).post(`${M}/messages/${pollId}/vote`, { optionIds: ["2"] })).body.data;
    expect(v.options.map((o: { votes: number }) => o.votes)).toEqual([0, 2, 0]);
    expect(v.options[1]).toMatchObject({ voters: ["bob", "carol"], mine: true });
    // An open chat picks the votes up when it checks for changes.
    const poll = (await as(alice).get(`${M}/conversations/${chat}/messages?after=${pollId}&since=${encodeURIComponent(before)}`)).body;
    expect(poll.changed.find((m: { id: string }) => m.id === pollId).data.voters).toBe(2);
    const back = (await as(carol).post(`${M}/messages/${pollId}/vote`, { optionIds: [] })).body.data;
    expect(back.voters).toBe(1);
    expect((await h.client(dave, tB).post(`${M}/messages/${pollId}/vote`, { optionIds: ["1"] })).status).toBe(404);

    const multi = (await send(alice, { kind: "poll", question: "Which days?", options: ["Mon", "Tue"], multiple: true })).body;
    expect((await as(bob).post(`${M}/messages/${multi.id}/vote`, { optionIds: ["1", "2"] })).body.data.options.map((o: { votes: number }) => o.votes)).toEqual([1, 1]);
  });

  it("events: date, place, and who is going", async () => {
    const r = await send(alice, { kind: "event", title: "Summer party", startsAt: "2027-06-20T18:00:00.000Z", location: "The garden" });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ title: "Summer party", location: "The garden", going: [], myAnswer: null });
    expect((await send(alice, { kind: "event", title: "Bad", startsAt: "2027-06-20T18:00:00.000Z", endsAt: "2027-06-20T17:00:00.000Z" })).status).toBe(400);
    await as(bob).post(`${M}/messages/${r.body.id}/answer`, { answer: "going" });
    const d = (await as(carol).post(`${M}/messages/${r.body.id}/answer`, { answer: "maybe" })).body.data;
    expect(d).toMatchObject({ going: ["bob"], maybe: ["carol"], no: [], myAnswer: "maybe" });
    expect((await as(carol).post(`${M}/messages/${r.body.id}/answer`, { answer: "no" })).body.data).toMatchObject({ maybe: [], no: ["carol"] });
  });

  it("contacts, stickers and GIFs", async () => {
    const c = await send(bob, { kind: "contact", name: "Plumber Pete", phone: "+34 600 123 456", company: "Pipes Ltd" });
    expect(c.body.data).toMatchObject({ name: "Plumber Pete", phone: "+34 600 123 456", email: null });
    expect(await last(alice)).toBe("👤 Plumber Pete");
    expect((await send(bob, { kind: "contact", name: "No way to reach" })).status).toBe(400);

    expect((await send(bob, { kind: "sticker", emoji: "🎉" })).body.data).toEqual({ emoji: "🎉" });
    expect((await send(bob, { kind: "sticker" })).status).toBe(400);

    const gif = { kind: "gif", url: "https://media2.giphy.com/media/abc123/200.gif", width: 200, height: 150, title: "Yay" };
    expect((await send(bob, gif)).status).toBe(201);
    expect(await last(alice)).toBe("GIF");
    expect((await send(bob, { ...gif, url: "https://evil.example.com/x.gif" })).status).toBe(400);
    // Without a GIPHY key, search is simply off.
    expect((await as(bob).get(`${M}/gifs?q=party`)).body).toEqual({ enabled: false, data: [] });
  });

  it("deleting a poll removes its votes; only written messages can be edited", async () => {
    const p = (await send(alice, { kind: "poll", question: "Delete me?", options: ["Yes", "No"] })).body;
    await as(bob).post(`${M}/messages/${p.id}/vote`, { optionIds: ["1"] });
    expect((await as(alice).patch(`${M}/messages/${p.id}`, { body: "edited" })).status).toBe(400);
    expect((await as(alice).del(`${M}/messages/${p.id}`)).status).toBe(204);
    const gone = (await as(bob).get(`${M}/conversations/${chat}/messages`)).body.data.find((m: { id: string }) => m.id === p.id);
    expect(gone).toMatchObject({ data: null, deletedAt: expect.any(String) });
    expect((await as(bob).post(`${M}/messages/${p.id}/vote`, { optionIds: ["1"] })).status).toBe(400);
  });
});
