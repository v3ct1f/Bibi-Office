import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext, type Person } from "@office/sdk";
import { conversations, eventAnswers, fileParts, files, members, messages, pollVotes, type MessageKind } from "./schema.ts";

// ── Input schemas ────────────────────────────────────────────────────────────
const groupName = z.string().trim().min(1, "Give the group a name").max(100, "Keep the name under 100 characters");
const userIds = z.array(z.uuid()).max(100);
const opt = (max: number) => z.string().trim().max(max).optional();

export const DirectInput = z.object({ userId: z.uuid() }).strict();
export const GroupInput = z.object({ name: groupName, memberIds: userIds.min(1, "Add at least one person") }).strict();
export const RenameInput = z.object({ name: groupName }).strict();
export const AddMembersInput = z.object({ userIds: userIds.min(1) }).strict();
export const MemberParams = z.object({ id: z.uuid(), userId: z.uuid() });

/** Types people can send. Anything that could run in a browser (HTML, SVG, scripts) is refused. */
export const FILE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/mp4", "audio/ogg", "audio/webm", "audio/wav",
  "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
type FileType = (typeof FILE_TYPES)[number];
export const MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Files travel in parts of this size (the last one is smaller). */
export const PART_BYTES = 4 * 1024 * 1024;
const fileType = z.enum(FILE_TYPES, { message: "Send a photo, video, audio, PDF, text, Word, Excel or PowerPoint file" });

export const UploadInput = z.object({
  name: z.string().trim().min(1).max(200),
  contentType: fileType,
  sizeBytes: z.number().int().min(1, "The file is empty").max(MAX_FILE_BYTES, "Files can be at most 16 MB"),
}).strict();
export const PartParams = z.object({ id: z.uuid(), idx: z.coerce.number().int().min(0).max(15) });
export const PartInput = z.object({ data: z.string().min(1).max(5_600_000) }).strict();
export const FileQuery = z.object({ part: z.coerce.number().int().min(0).max(15).default(0) });

const inlineFile = z.object({ name: z.string().trim().min(1).max(200), contentType: fileType, data: z.string().min(1).max(7_100_000, "Use an upload for files over 5 MB") }).strict();
const isoTime = z.iso.datetime({ offset: true });
const GIF_HOST = /^https:\/\/media[0-9]*\.giphy\.com\/media\/[A-Za-z0-9/._-]+$/;

const TextMsg = z.object({
  kind: z.literal("text"),
  body: z.string().max(10_000, "Messages can be at most 10,000 characters").default(""),
  /** An upload finished with the upload routes. */
  fileId: z.uuid().optional(),
  /** Small files can come along directly (base64). */
  file: inlineFile.optional(),
  /** Marks an audio file as a voice message recorded in the app. */
  voice: z.object({ durationMs: z.number().int().min(0).max(30 * 60_000) }).strict().optional(),
}).strict();
const PollMsg = z.object({
  kind: z.literal("poll"),
  question: z.string().trim().min(1, "Ask a question").max(300),
  options: z.array(z.string().trim().min(1, "Options can't be empty").max(100)).min(2, "Add at least two options").max(12, "At most 12 options"),
  multiple: z.boolean().default(false),
}).strict();
const EventMsg = z.object({
  kind: z.literal("event"),
  title: z.string().trim().min(1, "Give the event a name").max(200),
  startsAt: isoTime,
  endsAt: isoTime.optional(),
  location: opt(300),
  description: opt(2000),
}).strict().refine((e) => !e.endsAt || e.endsAt >= e.startsAt, { message: "The end must be after the start", path: ["endsAt"] });
const ContactMsg = z.object({
  kind: z.literal("contact"),
  name: z.string().trim().min(1, "Add a name").max(200),
  phone: opt(50), email: z.email().max(320).optional().or(z.literal("").transform(() => undefined)), company: opt(200), jobTitle: opt(200),
}).strict().refine((c) => c.phone || c.email, { message: "Add a phone number or an email" });
const StickerMsg = z.object({
  kind: z.literal("sticker"),
  /** A built-in sticker (one emoji, shown big)… */
  emoji: z.string().min(1).max(16).optional(),
  /** …or your own picture turned into a sticker. */
  fileId: z.uuid().optional(),
}).strict().refine((s) => !!s.emoji !== !!s.fileId, { message: "Pick a sticker" });
const GifMsg = z.object({
  kind: z.literal("gif"),
  url: z.string().max(500).regex(GIF_HOST, "Pick a GIF from the list"),
  width: z.number().int().min(1).max(2000),
  height: z.number().int().min(1).max(2000),
  title: z.string().max(200).default(""),
}).strict();
export const SendInput = z.preprocess(
  (v) => (v && typeof v === "object" && !("kind" in v) ? { ...v, kind: "text" } : v),
  z.discriminatedUnion("kind", [TextMsg, PollMsg, EventMsg, ContactMsg, StickerMsg, GifMsg]),
);
export type SendInputT = z.infer<typeof SendInput>;

export const EditInput = z.object({ body: z.string().trim().min(1, "Write something").max(10_000) }).strict();
export const VoteInput = z.object({ optionIds: z.array(z.string().max(10)).max(12) }).strict();
export const AnswerInput = z.object({ answer: z.enum(["going", "maybe", "no"]) }).strict();
export const GifQuery = z.object({ q: z.string().trim().max(100).optional() });
export const MessagesQuery = z.object({
  /** Only messages newer than this one (polling). */
  after: z.uuid().optional(),
  /** Only messages older than this one (scrolling back). */
  before: z.uuid().optional(),
  /** Also return earlier messages changed since this time: edits, deletions, votes, event answers (polling). */
  since: isoTime.optional(),
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
  await ctx.db.insert(messages).values({ id: uuidv7(), tenantId: ctx.tenantId, conversationId, senderId: me(ctx), kind: "system", body, createdAt: now, updatedAt: now });
  await ctx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
  // Whoever caused it has seen it.
  await ctx.db.update(members).set({ lastReadAt: now }).where(and(eq(members.conversationId, conversationId), eq(members.userId, me(ctx))));
}

type FileRow = { id: string; name: string; contentType: string; sizeBytes: number; partCount: number };
const fileDto = (f: FileRow | null) => (f ? { id: f.id, name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes, partCount: f.partCount } : null);

/** What the chat list shows for the last message. */
function preview(m: Message, file: FileRow | undefined) {
  if (m.deletedAt) return "Message deleted";
  const d = (m.data ?? {}) as Record<string, unknown>;
  switch (m.kind) {
    case "poll": return `📊 Poll: ${String(d.question ?? "")}`;
    case "event": return `📅 ${String(d.title ?? "Event")}`;
    case "contact": return `👤 ${String(d.name ?? "Contact")}`;
    case "sticker": return d.emoji ? `${String(d.emoji)} Sticker` : "Sticker";
    case "gif": return "GIF";
    default: break;
  }
  if (m.body) return m.body.slice(0, 140);
  if (d.voice) return "🎤 Voice message";
  const t = file?.contentType ?? "";
  return t.startsWith("image/") ? "📷 Photo" : t.startsWith("video/") ? "🎥 Video" : t.startsWith("audio/") ? "🎵 Audio" : file ? `📄 ${file.name}` : "";
}

async function messageDtos(ctx: ModuleContext, rows: Message[], people?: Map<string, Person>) {
  const ps = people ?? await peopleMap(ctx);
  const myId = me(ctx);
  const fileIds = rows.map((r) => r.fileId).filter((x): x is string => !!x);
  const fs = fileIds.length
    ? await ctx.db.select({ id: files.id, name: files.name, contentType: files.contentType, sizeBytes: files.sizeBytes, partCount: files.partCount })
      .from(files).where(inArray(files.id, fileIds))
    : [];
  const byId = new Map(fs.map((f) => [f.id, f]));
  const pollIds = rows.filter((r) => r.kind === "poll" && !r.deletedAt).map((r) => r.id);
  const votes = pollIds.length ? await ctx.db.select().from(pollVotes).where(inArray(pollVotes.messageId, pollIds)).orderBy(asc(pollVotes.createdAt)) : [];
  const eventIds = rows.filter((r) => r.kind === "event" && !r.deletedAt).map((r) => r.id);
  const answers = eventIds.length ? await ctx.db.select().from(eventAnswers).where(inArray(eventAnswers.messageId, eventIds)).orderBy(asc(eventAnswers.updatedAt)) : [];

  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>;
    let data: Record<string, unknown> | null = r.deletedAt ? null : r.data;
    if (r.kind === "poll" && data) {
      const mine = votes.filter((v) => v.messageId === r.id);
      const options = (d.options as { id: string; text: string }[]).map((o) => {
        const vs = mine.filter((v) => v.optionId === o.id);
        return { id: o.id, text: o.text, votes: vs.length, voters: vs.map((v) => nameOf(ps, v.userId)), mine: vs.some((v) => v.userId === myId) };
      });
      data = { question: d.question, multiple: !!d.multiple, options, voters: new Set(mine.map((v) => v.userId)).size };
    }
    if (r.kind === "event" && data) {
      const as = answers.filter((a) => a.messageId === r.id);
      const names = (k: string) => as.filter((a) => a.answer === k).map((a) => nameOf(ps, a.userId));
      data = { ...d, going: names("going"), maybe: names("maybe"), no: names("no"), myAnswer: as.find((a) => a.userId === myId)?.answer ?? null };
    }
    return {
      id: r.id, conversationId: r.conversationId, kind: r.kind,
      senderId: r.senderId, senderName: nameOf(ps, r.senderId), mine: r.senderId === myId && r.kind !== "system",
      body: r.deletedAt ? "" : r.body,
      file: r.deletedAt || !r.fileId ? null : fileDto(byId.get(r.fileId) ?? null),
      data,
      editedAt: r.editedAt, deletedAt: r.deletedAt, createdAt: r.createdAt,
    };
  });
}
export type MessageDto = Awaited<ReturnType<typeof messageDtos>>[number];

/** Unread = messages from others (not grey system lines) newer than when I last looked. */
const unreadWhere = (myId: string) => and(ne(messages.kind, "system"), sql`${messages.senderId} is distinct from ${myId}`,
  isNull(messages.deletedAt), gt(messages.createdAt, members.lastReadAt));

async function conversationDtos(ctx: ModuleContext, rows: { c: Conversation; m: Member }[], people?: Map<string, Person>) {
  if (!rows.length) return [];
  const ps = people ?? await peopleMap(ctx);
  const ids = rows.map((r) => r.c.id);
  const myId = me(ctx);
  const allMembers = await ctx.db.select().from(members).where(inArray(members.conversationId, ids)).orderBy(asc(members.joinedAt));
  const unread = await ctx.db.select({ id: messages.conversationId, n: sql<number>`count(*)::int` }).from(messages)
    .innerJoin(members, and(eq(members.conversationId, messages.conversationId), eq(members.userId, myId)))
    .where(and(inArray(messages.conversationId, ids), unreadWhere(myId)))
    .groupBy(messages.conversationId);
  const unreadBy = new Map(unread.map((u) => [u.id, u.n]));
  const last = await ctx.db.selectDistinctOn([messages.conversationId]).from(messages)
    .where(inArray(messages.conversationId, ids)).orderBy(messages.conversationId, desc(messages.id));
  const lastBy = new Map(last.map((l) => [l.conversationId, l]));
  const lastFiles = last.map((l) => l.fileId).filter((x): x is string => !!x);
  const lf = lastFiles.length
    ? await ctx.db.select({ id: files.id, name: files.name, contentType: files.contentType, sizeBytes: files.sizeBytes, partCount: files.partCount }).from(files).where(inArray(files.id, lastFiles))
    : [];
  const lfBy = new Map(lf.map((f) => [f.id, f]));
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
        preview: preview(l, l.fileId ? lfBy.get(l.fileId) : undefined),
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
    .where(unreadWhere(myId));
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
    changed = await ctx.db.select().from(messages)
      .where(and(base, gt(messages.updatedAt, new Date(q.since)), q.after ? sql`${messages.id} <= ${q.after}` : undefined))
      .limit(200);
  }
  const people = await peopleMap(ctx);
  return { data: await messageDtos(ctx, rows, people), changed: await messageDtos(ctx, changed, people), hasMore, now: now.toISOString() };
}

// ── Files ────────────────────────────────────────────────────────────────────
const ascii = (b: Buffer, from: number, to: number) => b.subarray(from, to).toString("latin1");
const isFtyp = (b: Buffer) => ascii(b, 4, 8) === "ftyp";
const isEbml = (b: Buffer) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const noNul = (b: Buffer) => !b.includes(0);
/** First bytes each type must start with, so a file is what it says it is. */
const MAGIC: Record<FileType, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  "image/gif": (b) => ascii(b, 0, 4) === "GIF8",
  "video/mp4": isFtyp, "video/quicktime": (b) => isFtyp(b) || ascii(b, 4, 8) === "moov" || ascii(b, 4, 8) === "wide",
  "video/webm": isEbml, "audio/webm": isEbml,
  "audio/mp4": isFtyp,
  "audio/mpeg": (b) => ascii(b, 0, 3) === "ID3" || (b[0] === 0xff && ((b[1] ?? 0) & 0xe0) === 0xe0),
  "audio/ogg": (b) => ascii(b, 0, 4) === "OggS",
  "audio/wav": (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE",
  "application/pdf": (b) => ascii(b, 0, 5) === "%PDF-",
  "text/plain": noNul, "text/csv": noNul,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZip,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": isZip,
};
const partSize = (size: number, idx: number, count: number) => (idx < count - 1 ? PART_BYTES : size - PART_BYTES * (count - 1));

/** Starts an upload into a chat; the parts follow with `uploadPart`, then a message refers to it. */
export async function startUpload(ctx: ModuleContext, conversationId: string, input: z.infer<typeof UploadInput>) {
  await mine(ctx, conversationId);
  const id = uuidv7();
  const partCount = Math.ceil(input.sizeBytes / PART_BYTES);
  await ctx.db.insert(files).values({
    id, tenantId: ctx.tenantId, conversationId, name: input.name, contentType: input.contentType, sizeBytes: input.sizeBytes,
    complete: false, partCount, uploadedBy: me(ctx),
  });
  return { id, partSize: PART_BYTES, partCount };
}

export async function uploadPart(ctx: ModuleContext, fileId: string, idx: number, input: z.infer<typeof PartInput>) {
  const [f] = await ctx.db.select().from(files).where(eq(files.id, fileId));
  if (!f || f.uploadedBy !== me(ctx)) throw E.notFound("Upload");
  if (f.complete) throw E.conflict("This file was already sent");
  if (idx >= f.partCount) throw E.badRequest("This file doesn't have that many parts");
  const data = Buffer.from(input.data, "base64");
  if (data.length !== partSize(f.sizeBytes, idx, f.partCount)) throw E.badRequest("This part has the wrong size");
  if (idx === 0 && !MAGIC[f.contentType as FileType](data)) throw E.badRequest("The file content does not match its type");
  await ctx.db.insert(fileParts).values({ tenantId: ctx.tenantId, fileId, idx, data })
    .onConflictDoUpdate({ target: [fileParts.fileId, fileParts.idx], set: { data } });
  return { ok: true };
}

/** Checks an upload is mine, in this chat and fully uploaded, then marks it sent. */
async function claimUpload(ctx: ModuleContext, fileId: string, conversationId: string) {
  const [f] = await ctx.db.select().from(files).where(eq(files.id, fileId)).for("update");
  if (!f || f.uploadedBy !== me(ctx) || f.conversationId !== conversationId) throw E.badRequest("That file isn't uploaded to this chat");
  if (f.complete) throw E.conflict("This file was already sent");
  const [n] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(fileParts).where(eq(fileParts.fileId, fileId));
  if ((n?.n ?? 0) !== f.partCount) throw E.badRequest("The file hasn't finished uploading");
  await ctx.db.update(files).set({ complete: true }).where(eq(files.id, fileId));
  return f;
}

async function storeInline(ctx: ModuleContext, conversationId: string, file: z.infer<typeof inlineFile>) {
  const data = Buffer.from(file.data, "base64");
  if (!data.length) throw E.badRequest("The file is empty");
  if (data.length > PART_BYTES) throw E.badRequest("Use an upload for files over 4 MB");
  if (!MAGIC[file.contentType](data)) throw E.badRequest("The file content does not match its type");
  const id = uuidv7();
  await ctx.db.insert(files).values({
    id, tenantId: ctx.tenantId, conversationId, name: file.name, contentType: file.contentType, sizeBytes: data.length, complete: true, partCount: 1, uploadedBy: me(ctx),
  });
  await ctx.db.insert(fileParts).values({ tenantId: ctx.tenantId, fileId: id, idx: 0, data });
  return { id, contentType: file.contentType as string };
}

export async function getFile(ctx: ModuleContext, id: string, part: number) {
  const [f] = await ctx.db.select().from(files).where(and(eq(files.id, id), eq(files.complete, true)));
  if (!f) throw E.notFound("File");
  await mine(ctx, f.conversationId).catch(() => { throw E.notFound("File"); });
  const [p] = await ctx.db.select().from(fileParts).where(and(eq(fileParts.fileId, id), eq(fileParts.idx, part)));
  if (!p) throw E.notFound("File part");
  return { id: f.id, name: f.name, contentType: f.contentType, sizeBytes: f.sizeBytes, partCount: f.partCount, part, data: p.data.toString("base64") };
}

/** Uploads never sent (closed tab, cancelled) are removed after a day. */
export async function purgeAbandonedUploads(ctx: ModuleContext) {
  const cutoff = new Date(Date.now() - 24 * 3600_000);
  await ctx.db.delete(files).where(and(eq(files.complete, false), lt(files.createdAt, cutoff)));
}

// ── GIF search (GIPHY, with the business's own key) ─────────────────────────
interface GiphyImage { url?: string; width?: string; height?: string }
interface GiphyItem { id: string; title?: string; images?: Record<string, GiphyImage> }
export async function searchGifs(ctx: ModuleContext, q: z.infer<typeof GifQuery>) {
  const key = ctx.secrets.get("giphyApiKey");
  if (!key) return { enabled: false, data: [] };
  const url = new URL(q.q ? "https://api.giphy.com/v1/gifs/search" : "https://api.giphy.com/v1/gifs/trending");
  url.searchParams.set("api_key", key);
  if (q.q) url.searchParams.set("q", q.q);
  url.searchParams.set("limit", "24");
  url.searchParams.set("rating", "g");
  let body: { data?: GiphyItem[] };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.status === 401 || res.status === 403) throw E.badRequest("The GIPHY key in Messages settings isn't valid");
    if (!res.ok) throw E.badRequest("GIF search isn't answering right now, try again in a moment");
    body = await res.json() as { data?: GiphyItem[] };
  } catch (e) {
    if (e instanceof Error && "statusCode" in e) throw e;
    throw E.badRequest("GIF search isn't answering right now, try again in a moment");
  }
  const strip = (u?: string) => u?.split("?")[0];
  const data = (body.data ?? []).flatMap((g) => {
    const full = g.images?.fixed_height, small = g.images?.fixed_width_small ?? g.images?.fixed_height_small ?? full;
    const u = strip(full?.url), p = strip(small?.url);
    if (!u || !p || !GIF_HOST.test(u) || !GIF_HOST.test(p)) return [];
    return [{ id: g.id, title: g.title ?? "", url: u, preview: p, width: Number(full?.width) || 200, height: Number(full?.height) || 200 }];
  });
  return { enabled: true, data };
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
    body: self ? `${nameOf(ps, myId)} left the group` : `${nameOf(ps, myId)} removed ${nameOf(ps, userId)}`, createdAt: now, updatedAt: now,
  });
  await ctx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, id));
  return self ? { deleted: false, left: true } : loadConversation(ctx, id);
}

export async function sendMessage(ctx: ModuleContext, conversationId: string, input: SendInputT) {
  const myId = me(ctx);
  const { c } = await mine(ctx, conversationId, true);
  if (c.kind === "direct") {
    const [other] = await ctx.db.select({ u: members.userId }).from(members).where(and(eq(members.conversationId, conversationId), ne(members.userId, myId)));
    if (other && !(await ctx.people.get(other.u))) throw E.badRequest("This person is no longer part of the business");
  }
  const kind: MessageKind = input.kind;
  let body = "";
  let fileId: string | null = null;
  let data: Record<string, unknown> | null = null;
  switch (input.kind) {
    case "text": {
      body = input.body.trim();
      if (input.fileId && input.file) throw E.badRequest("Send one file at a time");
      if (input.fileId) fileId = (await claimUpload(ctx, input.fileId, conversationId)).id;
      else if (input.file) fileId = (await storeInline(ctx, conversationId, input.file)).id;
      if (!body && !fileId) throw E.badRequest("Write a message or attach a file");
      if (input.voice) {
        const [f] = fileId ? await ctx.db.select({ t: files.contentType }).from(files).where(eq(files.id, fileId)) : [];
        if (!f?.t.startsWith("audio/")) throw E.badRequest("A voice message needs a recording");
        data = { voice: true, durationMs: input.voice.durationMs };
      }
      break;
    }
    case "poll":
      data = { question: input.question, multiple: input.multiple, options: input.options.map((text, i) => ({ id: String(i + 1), text })) };
      break;
    case "event":
      data = { title: input.title, startsAt: input.startsAt, endsAt: input.endsAt ?? null, location: input.location || null, description: input.description || null };
      break;
    case "contact":
      data = { name: input.name, phone: input.phone || null, email: input.email || null, company: input.company || null, jobTitle: input.jobTitle || null };
      break;
    case "sticker":
      if (input.fileId) {
        const f = await claimUpload(ctx, input.fileId, conversationId);
        if (!f.contentType.startsWith("image/")) throw E.badRequest("A sticker must be a picture");
        fileId = f.id;
        data = { custom: true };
      } else data = { emoji: input.emoji };
      break;
    case "gif":
      data = { url: input.url, width: input.width, height: input.height, title: input.title };
      break;
  }
  const now = new Date();
  const [row] = await ctx.db.insert(messages).values({
    id: uuidv7(), tenantId: ctx.tenantId, conversationId, senderId: myId, kind, body, fileId, data, createdAt: now, updatedAt: now,
  }).returning();
  await ctx.db.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
  await ctx.db.update(members).set({ lastReadAt: now }).where(and(eq(members.conversationId, conversationId), eq(members.userId, myId)));
  // No message content in the event: chats stay private to the people in them (events reach workflows and webhooks).
  await ctx.events.emit("messages.message.sent", { id: row!.id, conversationId, kind: c.kind, messageKind: kind, senderId: myId, hasFile: !!fileId });
  return (await messageDtos(ctx, [row!]))[0]!;
}

/** A message in a chat I'm in (locked), or 404. */
async function visibleMessage(ctx: ModuleContext, id: string) {
  const [r] = await ctx.db.select().from(messages).where(eq(messages.id, id)).for("update");
  if (!r) throw E.notFound("Message");
  await mine(ctx, r.conversationId).catch(() => { throw E.notFound("Message"); });
  return r;
}

async function ownMessage(ctx: ModuleContext, id: string) {
  const r = await visibleMessage(ctx, id);
  if (r.senderId !== me(ctx) || r.kind === "system") throw E.forbidden("You can only change your own messages");
  if (r.deletedAt) throw E.conflict("This message was deleted");
  return r;
}

export async function editMessage(ctx: ModuleContext, id: string, input: z.infer<typeof EditInput>) {
  const r = await ownMessage(ctx, id);
  if (r.kind !== "text" || (r.data as { voice?: boolean } | null)?.voice) throw E.badRequest("Only written messages can be edited");
  if (r.body === input.body) return (await messageDtos(ctx, [r]))[0]!;
  const now = new Date();
  const [row] = await ctx.db.update(messages).set({ body: input.body, editedAt: now, updatedAt: now }).where(eq(messages.id, id)).returning();
  return (await messageDtos(ctx, [row!]))[0]!;
}

export async function deleteMessage(ctx: ModuleContext, id: string) {
  const r = await ownMessage(ctx, id);
  const now = new Date();
  await ctx.db.update(messages).set({ body: "", fileId: null, data: null, deletedAt: now, updatedAt: now }).where(eq(messages.id, id));
  if (r.fileId) await ctx.db.delete(files).where(eq(files.id, r.fileId));
  await ctx.db.delete(pollVotes).where(eq(pollVotes.messageId, id));
  await ctx.db.delete(eventAnswers).where(eq(eventAnswers.messageId, id));
}

/** Replaces my votes on a poll (an empty list takes my vote back). */
export async function vote(ctx: ModuleContext, id: string, input: z.infer<typeof VoteInput>) {
  const r = await visibleMessage(ctx, id);
  if (r.kind !== "poll" || r.deletedAt) throw E.badRequest("That isn't a poll");
  const d = r.data as { multiple: boolean; options: { id: string }[] };
  const picked = [...new Set(input.optionIds)];
  if (picked.some((o) => !d.options.some((x) => x.id === o))) throw E.badRequest("That option isn't in the poll");
  if (!d.multiple && picked.length > 1) throw E.badRequest("Pick one option");
  const myId = me(ctx);
  await ctx.db.delete(pollVotes).where(and(eq(pollVotes.messageId, id), eq(pollVotes.userId, myId)));
  if (picked.length) await ctx.db.insert(pollVotes).values(picked.map((optionId) => ({ tenantId: ctx.tenantId, messageId: id, userId: myId, optionId })));
  const [row] = await ctx.db.update(messages).set({ updatedAt: new Date() }).where(eq(messages.id, id)).returning();
  return (await messageDtos(ctx, [row!]))[0]!;
}

export async function answerEvent(ctx: ModuleContext, id: string, input: z.infer<typeof AnswerInput>) {
  const r = await visibleMessage(ctx, id);
  if (r.kind !== "event" || r.deletedAt) throw E.badRequest("That isn't an event");
  const now = new Date();
  await ctx.db.insert(eventAnswers).values({ tenantId: ctx.tenantId, messageId: id, userId: me(ctx), answer: input.answer, updatedAt: now })
    .onConflictDoUpdate({ target: [eventAnswers.messageId, eventAnswers.userId], set: { answer: input.answer, updatedAt: now } });
  const [row] = await ctx.db.update(messages).set({ updatedAt: now }).where(eq(messages.id, id)).returning();
  return (await messageDtos(ctx, [row!]))[0]!;
}

export async function markRead(ctx: ModuleContext, conversationId: string) {
  await mine(ctx, conversationId);
  await ctx.db.update(members).set({ lastReadAt: new Date() }).where(and(eq(members.conversationId, conversationId), eq(members.userId, me(ctx))));
  return { ok: true };
}
