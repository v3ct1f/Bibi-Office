import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { MODELS, summarize, type Model } from "./claude.ts";
import { summaries, usage, type Kind, type Summary } from "./schema.ts";

export const P = { read: "ai:summaries.read", create: "ai:summaries.create", manage: "ai:summaries.manage" } as const;
const actorRef = (ctx: ModuleContext) => ctx.actor.userId ?? `${ctx.actor.type}:${ctx.actor.id}`;
const MAX_CHARS = 200_000;

// ───────────────────────── settings ─────────────────────────
export interface AiSettings { model: Model; monthlyTokenLimit: number; language: string; keepSource: boolean }
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: {
    apiKey: { type: "string", title: "Anthropic API key (sk-ant-…)", "x-secret": true, minLength: 10, maxLength: 300 },
    model: { type: "string", title: "Claude model", enum: [...MODELS], default: "claude-opus-5-5" },
    monthlyTokenLimit: { type: "integer", title: "Monthly token limit (input + output)", default: 2_000_000, minimum: 10_000, maximum: 1_000_000_000 },
    language: { type: "string", title: "Summary language (empty = same as the text)", default: "", maxLength: 40 },
    keepSource: { type: "boolean", title: "Keep the original text with each summary", default: true },
  },
  additionalProperties: false,
} as const;
export const settingsOf = (ctx: ModuleContext): AiSettings => ({ model: "claude-opus-5-5", monthlyTokenLimit: 2_000_000, language: "", keepSource: true, ...ctx.settings.get<Partial<AiSettings>>() });

// ───────────────────────── inputs ─────────────────────────
export const SummarizeIn = z.object({
  kind: z.enum(["meeting", "email", "notes"]).default("notes"),
  title: z.string().trim().max(200).optional(),
  text: z.string().trim().min(20, "Paste at least a few sentences").max(MAX_CHARS, "The text is too long (200,000 characters at most)"),
});
export const UploadQuery = z.object({ filename: z.string().min(1).max(255), kind: z.enum(["meeting", "email", "notes"]).default("meeting"), title: z.string().trim().max(200).optional() });
export const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), cursor: z.uuid().optional() });
export const TasksIn = z.object({ items: z.array(z.number().int().min(0).max(99)).min(1).max(50) });

// ───────────────────────── usage ─────────────────────────
const monthStart = (d = new Date()) => `${d.toISOString().slice(0, 7)}-01`;
export async function usageNow(ctx: ModuleContext) {
  const [u] = await ctx.db.select().from(usage).where(eq(usage.month, monthStart()));
  const used = (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0);
  const s = settingsOf(ctx);
  return { month: monthStart(), requests: u?.requests ?? 0, inputTokens: u?.inputTokens ?? 0, outputTokens: u?.outputTokens ?? 0, used, limit: s.monthlyTokenLimit };
}
async function addUsage(ctx: ModuleContext, input: number, output: number) {
  await ctx.db.insert(usage).values({ tenantId: ctx.tenantId, month: monthStart(), requests: 1, inputTokens: input, outputTokens: output })
    .onConflictDoUpdate({
      target: [usage.tenantId, usage.month],
      set: { requests: sql`${usage.requests} + 1`, inputTokens: sql`${usage.inputTokens} + ${input}`, outputTokens: sql`${usage.outputTokens} + ${output}` },
    });
}

export async function status(ctx: ModuleContext) {
  const s = settingsOf(ctx);
  return { configured: !!ctx.secrets.get("apiKey"), model: s.model, usage: await usageNow(ctx), canManage: ctx.authz.can(P.manage) };
}

// ───────────────────────── summaries ─────────────────────────
const view = (ctx: ModuleContext, s: Summary, names: Record<string, string> = {}) => {
  const { tenantId: _t, ...rest } = s;
  return { ...rest, createdByName: names[s.createdBy] ?? null, mine: s.createdBy === actorRef(ctx) };
};

/** Sends the text to Claude only now, on request. Checks the monthly cap first. */
export async function createSummary(ctx: ModuleContext, i: { kind: Kind; title?: string | undefined; text: string }) {
  const apiKey = ctx.secrets.get("apiKey");
  if (!apiKey) throw E.unprocessable("AI isn't set up yet. An admin needs to add an Anthropic API key in the module settings");
  const s = settingsOf(ctx);
  const u = await usageNow(ctx);
  if (u.used >= u.limit) throw E.conflict(`This month's AI limit is used up (${u.used.toLocaleString("en")} of ${u.limit.toLocaleString("en")} tokens). An admin can raise it`);
  const out = await summarize({ apiKey, model: s.model, kind: i.kind, title: i.title, text: i.text, language: s.language || undefined, today: await ctx.clock.today() });
  await addUsage(ctx, out.inputTokens, out.outputTokens);
  const title = (i.title || out.result?.title || "Untitled").slice(0, 200);
  const [row] = await ctx.db.insert(summaries).values({
    id: uuidv7(), tenantId: ctx.tenantId, kind: i.kind, title, sourceText: s.keepSource ? i.text : null, sourceChars: i.text.length,
    status: out.status, result: out.result, model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, tasksCreated: 0, createdBy: actorRef(ctx),
  }).returning();
  await ctx.audit.log("summary.created", { type: "ai.summary", id: row!.id }, { kind: i.kind, chars: i.text.length, model: out.model, status: out.status, tokens: out.inputTokens + out.outputTokens });
  if (out.status === "done") {
    await ctx.events.emit("ai.summary.created", { id: row!.id, kind: i.kind, title, tldr: out.result!.tldr, actionItems: out.result!.actionItems.length });
  }
  return view(ctx, row!);
}

const TEXT_TYPES = /\.(txt|md|vtt|srt|eml|csv)$/i;
/** Plain-text uploads only (transcripts, notes, saved emails). WebVTT/SRT cue timings are stripped. */
export function textFromUpload(f: { filename: string; bytes: Uint8Array }) {
  if (!TEXT_TYPES.test(f.filename)) throw E.badRequest("Upload a text file: .txt, .md, .vtt, .srt, .eml or .csv");
  let t: string;
  try { t = new TextDecoder("utf-8", { fatal: true }).decode(f.bytes); } catch { throw E.badRequest("The file isn't UTF-8 text"); }
  if (/\.(vtt|srt)$/i.test(f.filename)) {
    t = t.split(/\r?\n/).filter((l) => l.trim() && l.trim() !== "WEBVTT" && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join("\n");
  }
  return t.trim();
}

export async function listSummaries(ctx: ModuleContext, q: z.infer<typeof ListQuery>) {
  const rows = await ctx.db.select().from(summaries).where(q.cursor ? lt(summaries.id, q.cursor) : undefined).orderBy(desc(summaries.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const names = await ctx.people.names(page.map((r) => r.createdBy));
  return {
    data: page.map((r) => { const { sourceText: _s, ...v } = view(ctx, r, names); return v; }),
    nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
  };
}
async function load(ctx: ModuleContext, id: string) {
  const [s] = await ctx.db.select().from(summaries).where(eq(summaries.id, id));
  if (!s) throw E.notFound("Summary");
  return s;
}
export async function getSummary(ctx: ModuleContext, id: string) {
  const s = await load(ctx, id);
  return view(ctx, s, await ctx.people.names([s.createdBy]));
}
export async function deleteSummary(ctx: ModuleContext, id: string) {
  const s = await load(ctx, id);
  if (s.createdBy !== actorRef(ctx) && !ctx.authz.can(P.manage)) throw E.forbidden("Only the person who made it or an admin can delete this summary");
  await ctx.db.delete(summaries).where(and(eq(summaries.id, id)));
  await ctx.audit.log("summary.deleted", { type: "ai.summary", id }, { title: s.title });
}

/** Turn chosen action items into core tasks (the person picks them; nothing is created automatically). */
export async function createTasks(ctx: ModuleContext, id: string, items: number[]) {
  const s = await load(ctx, id);
  if (s.status !== "done" || !s.result) throw E.unprocessable("This summary has no action items");
  const picked = [...new Set(items)].map((n) => s.result!.actionItems[n]);
  if (picked.some((x) => !x)) throw E.badRequest("Unknown action item");
  const created: { id: string; title: string }[] = [];
  for (const a of picked) {
    const due = a!.due && /^\d{4}-\d{2}-\d{2}$/.test(a!.due) ? new Date(`${a!.due}T12:00:00Z`) : null;
    const t = await ctx.data.tasks.create({
      title: a!.task.slice(0, 200),
      description: `From the summary "${s.title}"${a!.owner ? `\nOwner: ${a!.owner}` : ""}`,
      ...(due && !Number.isNaN(due.getTime()) ? { dueAt: due.toISOString() } : {}),
    });
    created.push({ id: String(t.id), title: String(t.title) });
  }
  await ctx.db.update(summaries).set({ tasksCreated: sql`${summaries.tasksCreated} + ${created.length}` }).where(eq(summaries.id, id));
  await ctx.audit.log("summary.tasks_created", { type: "ai.summary", id }, { count: created.length });
  return { created };
}
