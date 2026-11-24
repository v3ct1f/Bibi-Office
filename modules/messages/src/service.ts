import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext, type Person } from "@office/sdk";
import { conversations, files, members, messages } from "./schema.ts";

// ── Input schemas ────────────────────────────────────────────────────────────
const groupName = z.string().trim().min(1, "Give the group a name").max(100, "Keep the name under 100 characters");
const userIds = z.array(z.uuid()).max(100);

export const DirectInput = z.object({ userId: z.uuid() }).strict();
export const GroupInput = z.object({ name: groupName, memberIds: userIds.min(1, "Add at least one person") }).strict();
export const RenameInput = z.object({ name: groupName }).strict();
export const AddMembersInput = z.object({ userIds: userIds.min(1) }).strict();
export const MemberParams = z.object({ id: z.uuid(), userId: z.uuid() });

export const FILE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const SendInput = z.object({
  body: z.string().max(10_000, "Messages can be at most 10,000 characters").default(""),
  file: z.object({
    name: z.string().trim().min(1).max(200),
    contentType: z.enum(FILE_TYPES, { message: "Send a photo, PDF, text, Word, Excel or PowerPoint file" }),
    data: z.string().min(1).max(7_100_000, "Files can be at most 5 MB"),
  }).strict().optional(),
}).strict();
export const EditInput = z.object({ body: z.string().trim().min(1, "Write something").max(10_000) }).strict();
export const MessagesQuery = z.object({
  /** Only messages newer than this one (polling). */
  after: z.uuid().optional(),
  /** Only messages older than this one (scrolling back). */
  before: z.uuid().optional(),
  /** Also return messages edited or deleted since this time (polling). */
  since: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ── Helpers ──────────────────────────────────────────────────────────────────
type Conversation = typeof conversations.$inferSelect;
type Message = typeof messages.$inferSelect;
type Member = typeof members.$inferSelect;

function me(ctx: ModuleContext): string {
  if (!ctx.actor.userId) throw E.badRequest("Messages belong to people: sign in as a user to chat");
  return ctx.actor.userId;
}

async function peopleMap(ctx: ModuleContext) {
  return new Map((await ctx.people.list()).map((p) => [p.userId, p] as const));
}
const nameOf = (people: Map<string, Person>, id: string | null) => {
  if (!id) return "Office";
  const p = people.get(id);
  return p ? p.name || p.email : "Former colleague";
};

/** The conversation and my membership; 404 when I'm not in it (nobody else can even see it exists). */
async function mine(ctx: ModuleContext, conversationId: string, lock = false) {
  const q = ctx.db.select({ c: conversations, m: members }).from(conversations)
    .innerJoin(members, and(eq(members.conversationId, conversations.id), eq(members.userId, me(ctx))))
    .where(eq(conversations.id, conversationId));
  const [r] = lock ? await q.for("update", { of: conversations }) : await q;
  if (!r) throw E.notFound("Conversation");
  return r;
}

async function activePeople(ctx: ModuleContext, ids: string[]) {
  const found = await Promise.all([...new Set(ids)].map((id) => ctx.people.get(id)));
  if (found.some((p) => !p)) throw E.badRequest("Everyone in a chat must be an active member of this business");
  return found as Person[];
}

async function systemMessage(ctx: ModuleContext, conversationId: string, body: string) {
  const now = new Date();
  await ctx.db.insert(messages).values({ id: uuidv7(), tenantId: ctx.tenantId, conversationId, senderId: me(ctx), kind: "system", body, createdAt: now });
  await ctx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
  // Whoever caused it has seen it.
  await ctx.db.update(members).set({ lastReadAt: now }).where(and(eq(members.conversationId, conversationId), eq(members.userId, me(ctx))));
}

const fileDto = (f: { id: string; name: string; contentType: string; sizeBytes: number } | null) =>
  f ? { id: f.id, name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes } : null;

async function messageDtos(ctx: ModuleContext, rows: Message[], people?: Map<string, Person>) {
  const ps = people ?? await peopleMap(ctx);
  const fileIds = rows.map((r) => r.fileId).filter((x): x is string => !!x);
  const fs = fileIds.length
    ? await ctx.db.select({ id: files.id, name: files.name, contentType: files.contentType, sizeBytes: files.sizeBytes }).from(files).where(inArray(files.id, fileIds))
    : [];
  const byId = new Map(fs.map((f) => [f.id, f]));
  const myId = me(ctx);
  return rows.map((r) => ({
    id: r.id, conversationId: r.conversationId, kind: r.kind,
    senderId: r.senderId, senderName: nameOf(ps, r.senderId), mine: r.senderId === myId && r.kind === "text",
    body: r.deletedAt ? "" : r.body,
    file: r.deletedAt || !r.fileId ? null : fileDto(byId.get(r.fileId) ?? null),
    editedAt: r.editedAt, deletedAt: r.deletedAt, createdAt: r.createdAt,
  }));
}
export type MessageDto = Awaited<ReturnType<typeof messageDtos>>[number];

async function conversationDtos(ctx: ModuleContext, rows: { c: Conversation; m: Member }[], people?: Map<string, Person>) {
  if (!rows.length) return [];
  const ps = people ?? await peopleMap(ctx);
  const ids = rows.map((r) => r.c.id);
  const myId = me(ctx);
  const allMembers = await ctx.db.select().from(members).where(inArray(members.conversationId, ids)).orderBy(asc(members.joinedAt));
  const unread = await ctx.db.select({ id: messages.conversationId, n: sql<number>`count(*)::int` }).from(messages)
    .innerJoin(members, and(eq(members.conversationId, messages.conversationId), eq(members.userId, myId)))
    .where(and(inArray(messages.conversationId, ids), eq(messages.kind, "text"), sql`${messages.senderId} is distinct from ${myId}`,
      sql`${messages.deletedAt} is null`, gt(messages.createdAt, members.lastReadAt)))
    .groupBy(messages.conversationId);
  const unreadBy = new Map(unread.map((u) => [u.id, u.n]));
  const last = await ctx.db.selectDistinctOn([messages.conversationId]).from(messages)
    .where(inArray(messages.conversationId, ids)).orderBy(messages.conversationId, desc(messages.id));
  const lastBy = new Map(last.map((l) => [l.conversationId, l]));
  return rows.map(({ c, m }) => {
    const ms = allMembers.filter((x) => x.conversationId === c.id).map((x) => ({
      userId: x.userId, name: nameOf(ps, x.userId), email: ps.get(x.userId)?.email ?? null, role: x.role, active: ps.has(x.userId), me: x.userId === myId,
    }));
    const other = c.kind === "direct" ? ms.find((x) => x.userId !== myId) : undefined;
    const l = lastBy.get(c.id);
    return {
      id: c.id, kind: c.kind, name: c.kind === "group" ? c.name! : other?.name ?? "Just you",
      members: ms, myRole: m.role, createdBy: c.createdBy, unread: unreadBy.get(c.id) ?? 0, lastMessageAt: c.lastMessageAt,
      lastMessage: l ? {
        kind: l.kind, senderName: nameOf(ps, l.senderId), mine: l.senderId === myId,
        preview: l.deletedAt ? "Message deleted" : l.body ? l.body.slice(0, 140) : l.fileId ? "Sent a file" : "",
      } : null,
    };
  });
}
export type ConversationDto = Awaited<ReturnType<typeof conversationDtos>>[number];

async function loadConversation(ctx: ModuleContext, id: string) {
  const r = await mine(ctx, id);
  return (await conversationDtos(ctx, [r]))[0]!;
}

// ── Queries ──────────────────────────────────────────────────────────────────
export async function listPeople(ctx: ModuleContext) {
  const myId = me(ctx);
  return (await ctx.people.list()).filter((p) => p.userId !== myId)
    .map((p) => ({ userId: p.userId, name: p.name || p.email, email: p.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listConversations(ctx: ModuleContext) {
  const rows = await ctx.db.select({ c: conversations, m: members }).from(conversations)
    .innerJoin(members, and(eq(members.conversationId, conversations.id), eq(members.userId, me(ctx))))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id)).limit(300);
  return conversationDtos(ctx, rows);
}

export const getConversation = loadConversation;

export async function unreadCount(ctx: ModuleContext) {
  const myId = me(ctx);
  const [r] = await ctx.db.select({ n: sql<number>`count(*)::int`, chats: sql<number>`count(distinct ${messages.conversationId})::int` }).from(messages)
    .innerJoin(members, and(eq(members.conversationId, messages.conversationId), eq(members.userId, myId)))
    .where(and(eq(messages.kind, "text"), sql`${messages.senderId} is distinct from ${myId}`, sql`${messages.deletedAt} is null`, gt(messages.createdAt, members.lastReadAt)));
  return { count: r?.n ?? 0, conversations: r?.chats ?? 0 };
}

export async function listMessages(ctx: ModuleContext, conversationId: string, q: z.infer<typeof MessagesQuery>) {
  await mine(ctx, conversationId);
  const now = new Date();
  const base = eq(messages.conversationId, conversationId);
  let rows: Message[];
  let hasMore = false;
  if (q.after) {
    rows = await ctx.db.select().from(messages).where(and(base, gt(messages.id, q.after))).orderBy(asc(messages.id)).limit(q.limit);
  } else {
    const r = await ctx.db.select().from(messages).where(and(base, q.before ? lt(messages.id, q.before) : undefined)).orderBy(desc(messages.id)).limit(q.limit + 1);
    hasMore = r.length > q.limit;
    rows = r.slice(0, q.limit).reverse();
  }
  let changed: Message[] = [];
  if (q.since) {
    const since = new Date(q.since);
    changed = await ctx.db.select().from(messages)
      .where(and(base, or(gt(messages.editedAt, since), gt(messages.deletedAt, since)), q.after ? sql`${messages.id} <= ${q.after}` : undefined))
      .limit(200);
  }
  const people = await peopleMap(ctx);
  return { data: await messageDtos(ctx, rows, people), changed: await messageDtos(ctx, changed, people), hasMore, now: now.toISOString() };
}

const MAGIC: Partial<Record<(typeof FILE_TYPES)[number], (b: Buffer) => boolean>> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "image/gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "text/plain": (b) => !b.includes(0),
  "text/csv": (b) => !b.includes(0),
};
const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

export async function getFile(ctx: ModuleContext, id: string) {
  const [f] = await ctx.db.select().from(files).where(eq(files.id, id));
  if (!f) throw E.notFound("File");
  await mine(ctx, f.conversationId).catch(() => { throw E.notFound("File"); });
  return { id: f.id, name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes, data: f.data.toString("base64") };
}

// ── Commands ─────────────────────────────────────────────────────────────────
/** Opens the one-to-one chat with a colleague, creating it the first time. */
export async function openDirect(ctx: ModuleContext, input: z.infer<typeof DirectInput>) {
  const myId = me(ctx);
  if (input.userId === myId) throw E.badRequest("Pick someone else to chat with");
  await activePeople(ctx, [input.userId]);
  const key = [myId, input.userId].sort().join(":");
  const id = uuidv7();
  const inserted = await ctx.db.insert(conversations).values({ id, tenantId: ctx.tenantId, kind: "direct", directKey: key, createdBy: myId })
    .onConflictDoNothing().returning({ id: conversations.id });
  if (inserted.length) {
    await ctx.db.insert(members).values([myId, input.userId].map((userId) => ({ tenantId: ctx.tenantId, conversationId: id, userId, role: "member" as const })));
    await ctx.events.emit("messages.conversation.created", { id, kind: "direct", memberIds: [myId, input.userId] });
    return loadConversation(ctx, id);
  }
  const [existing] = await ctx.db.select({ id: conversations.id }).from(conversations).where(eq(conversations.directKey, key));
  return loadConversation(ctx, existing!.id);
}

export async function createGroup(ctx: ModuleContext, input: z.infer<typeof GroupInput>) {
  const myId = me(ctx);
  const others = [...new Set(input.memberIds)].filter((x) => x !== myId);
  if (!others.length) throw E.badRequest("Add at least one other person");
  const people = await activePeople(ctx, others);
  const id = uuidv7();
  await ctx.db.insert(conversations).values({ id, tenantId: ctx.tenantId, kind: "group", name: input.name, createdBy: myId });
  await ctx.db.insert(members).values([
    { tenantId: ctx.tenantId, conversationId: id, userId: myId, role: "manager" as const },
    ...others.map((userId) => ({ tenantId: ctx.tenantId, conversationId: id, userId, role: "member" as const })),
  ]);
  const ps = await peopleMap(ctx);
  await systemMessage(ctx, id, `${nameOf(ps, myId)} created the group “${input.name}” with ${people.map((p) => p.name || p.email).join(", ")}`);
  await ctx.events.emit("messages.conversation.created", { id, kind: "group", name: input.name, memberIds: [myId, ...others] });
  return loadConversation(ctx, id);
}

export async function renameGroup(ctx: ModuleContext, id: string, input: z.infer<typeof RenameInput>) {
  const { c } = await mine(ctx, id, true);
  if (c.kind !== "group") throw E.badRequest("Only groups have a name you can change");
  if (c.name === input.name) return loadConversation(ctx, id);
  await ctx.db.update(conversations).set({ name: input.name }).where(eq(conversations.id, id));
  const ps = await peopleMap(ctx);
  await systemMessage(ctx, id, `${nameOf(ps, me(ctx))} renamed the group to “${input.name}”`);
  return loadConversation(ctx, id);
}

export async function addMembers(ctx: ModuleContext, id: string, input: z.infer<typeof AddMembersInput>) {
  const { c } = await mine(ctx, id, true);
  if (c.kind !== "group") throw E.badRequest("Start a group to chat with more people");
  const current = new Set((await ctx.db.select({ u: members.userId }).from(members).where(eq(members.conversationId, id))).map((x) => x.u));
  const fresh = [...new Set(input.userIds)].filter((u) => !current.has(u));
  if (!fresh.length) return loadConversation(ctx, id);
  if (current.size + fresh.length > 200) throw E.badRequest("A group can have at most 200 people");
  const people = await activePeople(ctx, fresh);
  await ctx.db.insert(members).values(fresh.map((userId) => ({ tenantId: ctx.tenantId, conversationId: id, userId, role: "member" as const })));
  const ps = await peopleMap(ctx);
  await systemMessage(ctx, id, `${nameOf(ps, me(ctx))} added ${people.map((p) => p.name || p.email).join(", ")}`);
  return loadConversation(ctx, id);
}

/** Leave a group yourself, or (group managers only) remove someone else. */
export async function removeMember(ctx: ModuleContext, id: string, userId: string) {
  const myId = me(ctx);
  const { c, m } = await mine(ctx, id, true);
  if (c.kind !== "group") throw E.badRequest("You can't leave a one-to-one chat");
  const self = userId === myId;
  if (!self && m.role !== "manager") throw E.forbidden("Only the group's managers can remove people");
  const [gone] = await ctx.db.delete(members).where(and(eq(members.conversationId, id), eq(members.userId, userId))).returning();
  if (!gone) throw E.notFound("Member");
  const left = await ctx.db.select().from(members).where(eq(members.conversationId, id)).orderBy(asc(members.joinedAt));
  if (!left.length) { await ctx.db.delete(conversations).where(eq(conversations.id, id)); return { deleted: true }; }
  // A group always keeps a manager: the longest-standing member takes over.
  if (!left.some((x) => x.role === "manager")) {
    await ctx.db.update(members).set({ role: "manager" }).where(and(eq(members.conversationId, id), eq(members.userId, left[0]!.userId)));
  }
  const ps = await peopleMap(ctx);
  // Written as the person acting; when leaving, they are no longer a member, so add the line directly.
  const now = new Date();
  await ctx.db.insert(messages).values({
    id: uuidv7(), tenantId: ctx.tenantId, conversationId: id, senderId: myId, kind: "system",
    body: self ? `${nameOf(ps, myId)} left the group` : `${nameOf(ps, myId)} removed ${nameOf(ps, userId)}`, createdAt: now,
  });
  await ctx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, id));
  return self ? { deleted: false, left: true } : loadConversation(ctx, id);
}

export async function sendMessage(ctx: ModuleContext, conversationId: string, input: z.infer<typeof SendInput>) {
  const myId = me(ctx);
  const { c } = await mine(ctx, conversationId, true);
  const body = input.body.trim();
  if (!body && !input.file) throw E.badRequest("Write a message or attach a file");
  if (c.kind === "direct") {
    const [other] = await ctx.db.select({ u: members.userId }).from(members).where(and(eq(members.conversationId, conversationId), ne(members.userId, myId)));
    if (other && !(await ctx.people.get(other.u))) throw E.badRequest("This person is no longer part of the business");
  }
  let fileId: string | null = null;
  if (input.file) {
    const data = Buffer.from(input.file.data, "base64");
    if (!data.length) throw E.badRequest("The file is empty");
    if (data.length > MAX_FILE_BYTES) throw E.badRequest("Files can be at most 5 MB");
    const check = MAGIC[input.file.contentType] ?? isZip;
    if (!check(data)) throw E.badRequest("The file content does not match its type");
    fileId = uuidv7();
    await ctx.db.insert(files).values({
      id: fileId, tenantId: ctx.tenantId, conversationId, name: input.file.name, contentType: input.file.contentType, sizeBytes: data.length, data, uploadedBy: myId,
    });
  }
  const now = new Date();
  const [row] = await ctx.db.insert(messages).values({ id: uuidv7(), tenantId: ctx.tenantId, conversationId, senderId: myId, kind: "text", body, fileId, createdAt: now }).returning();
  await ctx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
  await ctx.db.update(members).set({ lastReadAt: now }).where(and(eq(members.conversationId, conversationId), eq(members.userId, myId)));
  // No message text in the event: chats stay private to the people in them (events reach workflows and webhooks).
  await ctx.events.emit("messages.message.sent", { id: row!.id, conversationId, kind: c.kind, senderId: myId, hasFile: !!fileId });
  return (await messageDtos(ctx, [row!]))[0]!;
}

async function ownMessage(ctx: ModuleContext, id: string) {
  const [r] = await ctx.db.select().from(messages).where(eq(messages.id, id)).for("update");
  if (!r) throw E.notFound("Message");
  await mine(ctx, r.conversationId).catch(() => { throw E.notFound("Message"); });
  if (r.senderId !== me(ctx) || r.kind !== "text") throw E.forbidden("You can only change your own messages");
  if (r.deletedAt) throw E.conflict("This message was deleted");
  return r;
}

export async function editMessage(ctx: ModuleContext, id: string, input: z.infer<typeof EditInput>) {
  const r = await ownMessage(ctx, id);
  if (r.body === input.body) return (await messageDtos(ctx, [r]))[0]!;
  const [row] = await ctx.db.update(messages).set({ body: input.body, editedAt: new Date() }).where(eq(messages.id, id)).returning();
  return (await messageDtos(ctx, [row!]))[0]!;
}

export async function deleteMessage(ctx: ModuleContext, id: string) {
  const r = await ownMessage(ctx, id);
  await ctx.db.update(messages).set({ body: "", fileId: null, deletedAt: new Date() }).where(eq(messages.id, id));
  if (r.fileId) await ctx.db.delete(files).where(eq(files.id, r.fileId));
}

export async function markRead(ctx: ModuleContext, conversationId: string) {
  await mine(ctx, conversationId);
  await ctx.db.update(members).set({ lastReadAt: new Date() }).where(and(eq(members.conversationId, conversationId), eq(members.userId, me(ctx))));
  return { ok: true };
}
