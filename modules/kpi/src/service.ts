import { randomBytes } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { dashboards, type Dashboard, type Tile } from "./schema.ts";

export const P = { read: "kpi:dashboards.read", manage: "kpi:dashboards.manage" } as const;
const actorRef = (ctx: ModuleContext) => ctx.actor.userId ?? `${ctx.actor.type}:${ctx.actor.id}`;
const MAX_DASHBOARDS = 20;

const TileIn = z.object({
  id: z.string().regex(/^[\w-]{4,24}$/).optional(),
  metric: z.string().regex(/^[a-z][a-z0-9-]{1,40}\.[a-z][a-z0-9_]{0,40}$/, "Unknown metric"),
  view: z.enum(["number", "line", "bar"]).default("number"),
  target: z.number().finite().min(-1e15).max(1e15).nullable().default(null),
});
export const DashboardIn = z.object({ name: z.string().trim().min(1).max(80), tiles: z.array(TileIn).max(24).default([]) });
export const DashboardPatch = z.object({ name: z.string().trim().min(1).max(80).optional(), tiles: z.array(TileIn).max(24).optional(), position: z.number().int().min(0).max(1000).optional() });

const newId = () => randomBytes(6).toString("base64url");
const tilesOf = (t: z.infer<typeof TileIn>[]): Tile[] => t.map((x) => ({ id: x.id ?? newId(), metric: x.metric, view: x.view, target: x.target }));
const view = ({ tenantId: _t, ...d }: Dashboard) => d;

/** Starting layout: the main number of each built-in module. Tiles for modules that are off show as unavailable until enabled. */
export const DEFAULT_TILES: Omit<Tile, "id">[] = [
  { metric: "invoicing.revenue", view: "bar", target: null },
  { metric: "invoicing.overdue", view: "number", target: null },
  { metric: "crm.won_value", view: "line", target: null },
  { metric: "crm.pipeline", view: "number", target: null },
  { metric: "expenses.spend", view: "bar", target: null },
  { metric: "support.open_tickets", view: "number", target: null },
  { metric: "support.first_response", view: "number", target: null },
  { metric: "scheduling.bookings", view: "line", target: null },
  { metric: "inventory.low_stock", view: "number", target: null },
  { metric: "docs.waiting", view: "number", target: null },
  { metric: "hr.headcount", view: "number", target: null },
];

export async function seed(ctx: ModuleContext) {
  const [n] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(dashboards);
  if (n!.n > 0) return;
  await ctx.db.insert(dashboards).values({ id: uuidv7(), tenantId: ctx.tenantId, name: "Overview", position: 0, tiles: DEFAULT_TILES.map((t) => ({ ...t, id: newId() })), createdBy: actorRef(ctx) });
}

export async function list(ctx: ModuleContext) {
  const rows = await ctx.db.select().from(dashboards).orderBy(asc(dashboards.position), asc(dashboards.createdAt));
  return { data: rows.map(view), canManage: ctx.authz.can(P.manage) };
}
async function load(ctx: ModuleContext, id: string) {
  const [d] = await ctx.db.select().from(dashboards).where(eq(dashboards.id, id));
  if (!d) throw E.notFound("Dashboard");
  return d;
}
export const get = async (ctx: ModuleContext, id: string) => view(await load(ctx, id));

const uniqueName = (e: unknown) => {
  const c = (e as { cause?: { code?: string } }).cause ?? e;
  if ((c as { code?: string }).code === "23505") throw E.conflict("A dashboard with this name already exists");
  throw e;
};

export async function create(ctx: ModuleContext, i: z.infer<typeof DashboardIn>) {
  const [n] = await ctx.db.select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(position), -1)::int` }).from(dashboards);
  if (n!.n >= MAX_DASHBOARDS) throw E.conflict(`At most ${MAX_DASHBOARDS} dashboards`);
  const [d] = await ctx.db.insert(dashboards).values({ id: uuidv7(), tenantId: ctx.tenantId, name: i.name, position: n!.max + 1, tiles: tilesOf(i.tiles), createdBy: actorRef(ctx) })
    .returning().catch(uniqueName);
  await ctx.audit.log("dashboard.created", { type: "kpi.dashboard", id: d!.id }, { name: i.name });
  return view(d!);
}

export async function update(ctx: ModuleContext, id: string, p: z.infer<typeof DashboardPatch>) {
  await load(ctx, id);
  const [d] = await ctx.db.update(dashboards).set({
    ...(p.name !== undefined ? { name: p.name } : {}), ...(p.tiles ? { tiles: tilesOf(p.tiles) } : {}), ...(p.position !== undefined ? { position: p.position } : {}), updatedAt: new Date(),
  }).where(eq(dashboards.id, id)).returning().catch(uniqueName);
  await ctx.audit.log("dashboard.updated", { type: "kpi.dashboard", id }, { name: p.name, tiles: p.tiles?.length });
  return view(d!);
}

export async function remove(ctx: ModuleContext, id: string) {
  const d = await load(ctx, id);
  await ctx.db.delete(dashboards).where(eq(dashboards.id, id));
  await ctx.audit.log("dashboard.deleted", { type: "kpi.dashboard", id }, { name: d.name });
}
