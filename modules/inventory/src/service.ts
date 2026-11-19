import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { items, locations, movements, stock, type Item, type MovementKind } from "./schema.ts";

export const P = {
  read: "inventory:items.read", move: "inventory:stock.move", adjust: "inventory:stock.adjust", manage: "inventory:items.manage",
} as const;
const pgCode = (e: unknown): string | undefined => (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;
const pgConstraint = (e: unknown): string | undefined => (e as { constraint_name?: string }).constraint_name ?? (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;

// ───────────────────────── settings ─────────────────────────
export interface InventorySettings { currency: string }
export const SETTINGS_SCHEMA = {
  type: "object",
  properties: { currency: { type: "string", title: "Currency for costs and prices", default: "EUR", pattern: "^[A-Z]{3}$" } },
  additionalProperties: false,
} as const;
export const settingsOf = (ctx: ModuleContext): InventorySettings => ({ currency: "EUR", ...ctx.settings.get<Partial<InventorySettings>>() });

// ───────────────────────── input schemas ─────────────────────────
const quantity = z.number().positive().max(1e10).refine((n) => Math.round(n * 1000) === n * 1000, "At most 3 decimals");
const minor = z.number().int().min(0).max(1e12);
const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === "" ? null : v));
const ItemFields = {
  sku: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/, "Letters, digits and . _ / - only"),
  name: z.string().trim().min(1).max(200),
  description: optText(2000), category: optText(80),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  barcode: optText(64),
  cost: minor.default(0).describe("minor units, e.g. cents"),
  price: minor.nullable().optional(),
  reorderPoint: z.number().min(0).max(1e10).nullable().optional(),
  reorderQty: quantity.nullable().optional(),
};
export const ItemIn = z.object({ ...ItemFields, openingStock: z.object({ locationId: z.uuid(), quantity }).optional() });
export const ItemPatch = z.object({
  ...ItemFields, sku: ItemFields.sku.optional(), name: ItemFields.name.optional(), unit: z.string().trim().min(1).max(20).optional(), cost: minor.optional(),
  archived: z.boolean().optional(),
}).refine((x) => Object.keys(x).length > 0, "Nothing to change");
export const ItemQuery = z.object({
  q: z.string().trim().max(100).optional(), category: z.string().max(80).optional(), locationId: z.uuid().optional(),
  low: z.stringbool().default(false), archived: z.stringbool().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100), cursor: z.string().max(300).optional(),
});
export const LocationIn = z.object({ name: z.string().trim().min(1).max(80), position: z.number().int().min(0).max(1000).default(0) });
export const LocationPatch = z.object({ name: z.string().trim().min(1).max(80).optional(), position: z.number().int().min(0).max(1000).optional(), archived: z.boolean().optional() });
const Common = { itemId: z.uuid(), reference: optText(120), note: optText(1000) };
export const MoveIn = z.discriminatedUnion("type", [
  z.object({ type: z.literal("receive"), ...Common, locationId: z.uuid(), quantity, unitCost: minor.optional() }),
  z.object({ type: z.literal("issue"), ...Common, locationId: z.uuid(), quantity }),
  z.object({ type: z.literal("transfer"), ...Common, locationId: z.uuid(), toLocationId: z.uuid(), quantity }),
  z.object({ type: z.literal("adjust"), ...Common, locationId: z.uuid(), delta: z.number().min(-1e10).max(1e10).refine((n) => n !== 0, "Change must not be 0"), note: z.string().trim().min(1, "Say why").max(1000) }),
]);
export const CountIn = z.object({
  locationId: z.uuid(), reference: optText(120),
  lines: z.array(z.object({ itemId: z.uuid(), counted: z.number().min(0).max(1e10) })).min(1).max(1000),
});
export const MovementQuery = z.object({
  itemId: z.uuid().optional(), locationId: z.uuid().optional(), kind: z.enum(["receipt", "issue", "adjustment", "transfer_out", "transfer_in", "count"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional(),
});

// ───────────────────────── helpers ─────────────────────────
const actorRef = (ctx: ModuleContext) => ctx.actor.userId ?? `${ctx.actor.type}:${ctx.actor.id}`;
const byLabel = (ref: string, names: Record<string, string>) =>
  names[ref] ?? (ref.startsWith("api_key:") ? "API key" : ref.includes(":") ? "Workflow" : "Former member");
const round3 = (n: number) => Math.round(n * 1000) / 1000;
async function loadItem(ctx: ModuleContext, id: string, lock = false) {
  const q = ctx.db.select().from(items).where(eq(items.id, id));
  const [i] = lock ? await q.for("update") : await q;
  if (!i) throw E.notFound("Item");
  return i;
}
async function loadLocation(ctx: ModuleContext, id: string) {
  const [l] = await ctx.db.select().from(locations).where(eq(locations.id, id));
  if (!l) throw E.notFound("Location");
  return l;
}
async function onHandTotal(ctx: ModuleContext, itemId: string) {
  const [r] = await ctx.db.select({ q: sql<string>`coalesce(sum(${stock.quantity}), 0)` }).from(stock).where(eq(stock.itemId, itemId));
  return Number(r?.q ?? 0);
}
const isLow = (i: Pick<Item, "reorderPoint">, onHand: number) => i.reorderPoint != null && onHand <= i.reorderPoint;
const itemPayload = (i: Item, onHand?: number) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, ...(onHand !== undefined ? { onHand } : {}), reorderPoint: i.reorderPoint });
const saveErr = (e: unknown): never => {
  const c = pgCode(e), k = pgConstraint(e);
  if (c === "23505" && k === "inventory_items_sku") throw E.conflict("Another item has this SKU");
  if (c === "23505" && k === "inventory_items_barcode") throw E.conflict("Another item has this barcode");
  if (c === "23505" && k === "inventory_locations_name") throw E.conflict("A location with this name exists");
  throw e;
};

// ───────────────────────── locations ─────────────────────────
export async function seedLocation(ctx: ModuleContext) {
  const [any] = await ctx.db.select({ id: locations.id }).from(locations).limit(1);
  if (!any) await ctx.db.insert(locations).values({ id: uuidv7(), tenantId: ctx.tenantId, name: "Main", archived: false, position: 0 });
}
export async function listLocations(ctx: ModuleContext) {
  const rows = await ctx.db.select({
    l: locations, items: sql<number>`(select count(*)::int from inventory_stock s where s.location_id = ${locations.id} and s.quantity > 0)`,
  }).from(locations).orderBy(asc(locations.position), asc(locations.name));
  return { data: rows.map((r) => ({ ...r.l, itemsInStock: r.items })) };
}
export async function createLocation(ctx: ModuleContext, i: z.infer<typeof LocationIn>) {
  try {
    const [l] = await ctx.db.insert(locations).values({ id: uuidv7(), tenantId: ctx.tenantId, archived: false, ...i }).returning();
    await ctx.audit.log("location.created", { type: "inventory.location", id: l!.id }, i);
    return l!;
  } catch (e) { return saveErr(e); }
}
export async function updateLocation(ctx: ModuleContext, id: string, p: z.infer<typeof LocationPatch>) {
  await loadLocation(ctx, id);
  if (p.archived) {
    const [r] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(stock).where(and(eq(stock.locationId, id), sql`${stock.quantity} > 0`));
    if (r!.n) throw E.conflict("Move or count out the stock at this location before archiving it");
  }
  try {
    const [l] = await ctx.db.update(locations).set(p).where(eq(locations.id, id)).returning();
    await ctx.audit.log("location.updated", { type: "inventory.location", id }, p);
    return l!;
  } catch (e) { return saveErr(e); }
}

// ───────────────────────── items ─────────────────────────
const totals = sql<string>`coalesce((select sum(s.quantity) from inventory_stock s where s.item_id = ${items.id}), 0)`;
export async function listItems(ctx: ModuleContext, q: z.infer<typeof ItemQuery>) {
  const conds: (SQL | undefined)[] = [eq(items.archived, q.archived)];
  if (q.category) conds.push(eq(items.category, q.category));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(items.sku, like), ilike(items.name, like), ilike(items.category, like), eq(items.barcode, q.q)));
  }
  const onHand = q.locationId
    ? sql<string>`coalesce((select s.quantity from inventory_stock s where s.item_id = ${items.id} and s.location_id = ${q.locationId}), 0)`
    : totals;
  if (q.low) conds.push(sql`${items.reorderPoint} is not null and ${totals} <= ${items.reorderPoint}`);
  if (q.cursor) {
    const [name, id] = [q.cursor.slice(0, q.cursor.lastIndexOf("|")), q.cursor.slice(q.cursor.lastIndexOf("|") + 1)];
    if (!z.uuid().safeParse(id).success) throw E.badRequest("Invalid cursor");
    conds.push(sql`(lower(${items.name}), ${items.id}) > (${name}, ${id}::uuid)`);
  }
  const rows = await ctx.db.select({ i: items, onHand, total: totals }).from(items).where(and(...conds))
    .orderBy(asc(sql`lower(${items.name})`), asc(items.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit), last = page.at(-1);
  const categories = (await ctx.db.selectDistinct({ c: items.category }).from(items).where(sql`${items.category} is not null and not ${items.archived}`)).map((r) => r.c!).sort();
  return {
    currency: settingsOf(ctx).currency, categories,
    data: page.map((r) => ({ ...r.i, onHand: Number(r.onHand), low: isLow(r.i, Number(r.total)), value: Math.round(Number(r.onHand) * r.i.cost) })),
    nextCursor: rows.length > q.limit && last ? `${last.i.name.toLowerCase()}|${last.i.id}` : null,
  };
}

export async function getItem(ctx: ModuleContext, id: string) {
  const i = await loadItem(ctx, id);
  const byLoc = await ctx.db.select({ locationId: locations.id, name: locations.name, archived: locations.archived, quantity: sql<string>`coalesce(${stock.quantity}, 0)` })
    .from(locations).leftJoin(stock, and(eq(stock.locationId, locations.id), eq(stock.itemId, id)))
    .orderBy(asc(locations.position), asc(locations.name));
  const stockRows = byLoc.filter((r) => !r.archived || Number(r.quantity) > 0).map((r) => ({ locationId: r.locationId, location: r.name, quantity: Number(r.quantity) }));
  const onHand = round3(stockRows.reduce((s, r) => s + r.quantity, 0));
  return { ...i, currency: settingsOf(ctx).currency, onHand, low: isLow(i, onHand), value: Math.round(onHand * i.cost), stock: stockRows };
}

export async function createItem(ctx: ModuleContext, i: z.infer<typeof ItemIn>) {
  const { openingStock, ...fields } = i;
  let row: Item;
  try {
    [row] = await ctx.db.insert(items).values({ id: uuidv7(), tenantId: ctx.tenantId, archived: false, ...fields }).returning() as [Item];
  } catch (e) { return saveErr(e); }
  await ctx.audit.log("item.created", { type: "inventory.item", id: row.id }, { sku: row.sku, name: row.name });
  await ctx.events.emit("inventory.item.created", itemPayload(row, 0));
  if (openingStock) await move(ctx, { type: "receive", itemId: row.id, locationId: openingStock.locationId, quantity: openingStock.quantity, reference: "Opening stock", note: null });
  return getItem(ctx, row.id);
}

export async function updateItem(ctx: ModuleContext, id: string, p: z.infer<typeof ItemPatch>) {
  const cur = await loadItem(ctx, id, true);
  if (p.archived && (await onHandTotal(ctx, id)) > 0) throw E.conflict("Issue or count out the remaining stock before archiving");
  try {
    await ctx.db.update(items).set({ ...p, updatedAt: new Date() }).where(eq(items.id, id));
  } catch (e) { return saveErr(e); }
  const changed = Object.keys(p).filter((k) => (cur as Record<string, unknown>)[k] !== (p as Record<string, unknown>)[k]);
  await ctx.audit.log("item.updated", { type: "inventory.item", id }, Object.fromEntries(changed.map((k) => [k, { from: (cur as Record<string, unknown>)[k], to: (p as Record<string, unknown>)[k] }])));
  return getItem(ctx, id);
}

// ───────────────────────── stock movements ─────────────────────────
interface Line { locationId: string; kind: MovementKind; quantity: number; unitCost?: number | null | undefined }
/** Insert ledger rows (the trigger updates on-hand; it refuses to go below zero). Emits low-stock when the total crosses the reorder point. */
async function post(ctx: ModuleContext, item: Item, lines: Line[], meta: { groupId: string; reference?: string | null | undefined; note?: string | null | undefined }) {
  const before = await onHandTotal(ctx, item.id);
  try {
    await ctx.db.insert(movements).values(lines.map((l) => ({
      id: uuidv7(), tenantId: ctx.tenantId, itemId: item.id, locationId: l.locationId, kind: l.kind, quantity: round3(l.quantity),
      unitCost: l.unitCost ?? null, groupId: meta.groupId, reference: meta.reference ?? null, note: meta.note ?? null, createdBy: actorRef(ctx),
    })));
  } catch (e) {
    if (pgCode(e) === "23514" && pgConstraint(e) === "inventory_stock_not_negative") throw E.conflict(`Not enough ${item.name} in stock at that location`);
    throw e;
  }
  const after = await onHandTotal(ctx, item.id);
  if (isLow(item, after) && !isLow(item, before)) {
    await ctx.events.emit("inventory.stock.low", { ...itemPayload(item, after), reorderQty: item.reorderQty });
  }
  return after;
}

export async function move(ctx: ModuleContext, m: z.infer<typeof MoveIn>) {
  const item = await loadItem(ctx, m.itemId, true);   // serializes moves per item
  if (item.archived) throw E.unprocessable("This item is archived");
  const loc = await loadLocation(ctx, m.locationId);
  if (loc.archived && m.type !== "issue" && m.type !== "transfer" && m.type !== "adjust") throw E.unprocessable("That location is archived");
  const groupId = uuidv7();
  const meta = { groupId, reference: m.reference, note: m.note };
  let onHand: number, type: string, payload: Record<string, unknown>;
  switch (m.type) {
    case "receive": {
      onHand = await post(ctx, item, [{ locationId: loc.id, kind: "receipt", quantity: m.quantity, unitCost: m.unitCost }], meta);
      // keep a moving average cost when a receipt carries its cost
      if (m.unitCost !== undefined) {
        const prev = Math.max(0, onHand - m.quantity);
        const avg = onHand > 0 ? Math.round((prev * item.cost + m.quantity * m.unitCost) / onHand) : m.unitCost;
        await ctx.db.update(items).set({ cost: avg, updatedAt: new Date() }).where(eq(items.id, item.id));
      }
      type = "inventory.stock.received"; payload = { quantity: m.quantity, locationId: loc.id, unitCost: m.unitCost ?? null };
      break;
    }
    case "issue":
      onHand = await post(ctx, item, [{ locationId: loc.id, kind: "issue", quantity: -m.quantity }], meta);
      type = "inventory.stock.issued"; payload = { quantity: m.quantity, locationId: loc.id };
      break;
    case "transfer": {
      if (m.toLocationId === m.locationId) throw E.badRequest("Pick two different locations");
      const to = await loadLocation(ctx, m.toLocationId);
      if (to.archived) throw E.unprocessable("That location is archived");
      onHand = await post(ctx, item, [{ locationId: loc.id, kind: "transfer_out", quantity: -m.quantity }, { locationId: to.id, kind: "transfer_in", quantity: m.quantity }], meta);
      type = "inventory.stock.transferred"; payload = { quantity: m.quantity, fromLocationId: loc.id, toLocationId: to.id };
      break;
    }
    case "adjust":
      ctx.authz.require(P.adjust);
      onHand = await post(ctx, item, [{ locationId: loc.id, kind: "adjustment", quantity: m.delta }], meta);
      type = "inventory.stock.adjusted"; payload = { delta: m.delta, locationId: loc.id, reason: m.note };
      break;
  }
  await ctx.audit.log(`stock.${m.type}`, { type: "inventory.item", id: item.id }, { ...payload, reference: m.reference ?? null });
  await ctx.events.emit(type, { ...itemPayload(item, onHand), ...payload, reference: m.reference ?? null, groupId });
  return getItem(ctx, item.id);
}

/** Stock count at one location: records the difference for each counted item. */
export async function recordCount(ctx: ModuleContext, c: z.infer<typeof CountIn>) {
  const loc = await loadLocation(ctx, c.locationId);
  const ids = [...new Set(c.lines.map((l) => l.itemId))];
  if (ids.length !== c.lines.length) throw E.badRequest("Each item may appear once");
  const its = await ctx.db.select().from(items).where(inArray(items.id, ids)).orderBy(asc(items.id)).for("update");
  if (its.length !== ids.length) throw E.notFound("Item");
  const cur = new Map((await ctx.db.select().from(stock).where(and(eq(stock.locationId, loc.id), inArray(stock.itemId, ids)))).map((s) => [s.itemId, s.quantity]));
  const groupId = uuidv7();
  const changes: { itemId: string; sku: string; before: number; counted: number; delta: number }[] = [];
  for (const l of c.lines) {
    const item = its.find((x) => x.id === l.itemId)!;
    const before = cur.get(l.itemId) ?? 0, delta = round3(l.counted - before);
    if (delta !== 0) await post(ctx, item, [{ locationId: loc.id, kind: "count", quantity: delta }], { groupId, reference: c.reference, note: `Counted ${l.counted}` });
    changes.push({ itemId: item.id, sku: item.sku, before, counted: l.counted, delta });
  }
  const differences = changes.filter((x) => x.delta !== 0);
  await ctx.audit.log("stock.counted", { type: "inventory.location", id: loc.id }, { lines: c.lines.length, differences: differences.length, groupId });
  if (differences.length) await ctx.events.emit("inventory.stock.adjusted", { locationId: loc.id, groupId, count: true, changes: differences });
  return { groupId, location: loc.name, counted: changes.length, differences };
}

export async function listMovements(ctx: ModuleContext, q: z.infer<typeof MovementQuery>) {
  const conds: (SQL | undefined)[] = [];
  if (q.itemId) conds.push(eq(movements.itemId, q.itemId));
  if (q.locationId) conds.push(eq(movements.locationId, q.locationId));
  if (q.kind) conds.push(eq(movements.kind, q.kind));
  if (q.cursor) { if (!z.uuid().safeParse(q.cursor).success) throw E.badRequest("Invalid cursor"); conds.push(sql`${movements.id} < ${q.cursor}::uuid`); }
  const rows = await ctx.db.select({ m: movements, sku: items.sku, itemName: items.name, unit: items.unit, location: locations.name })
    .from(movements).innerJoin(items, eq(items.id, movements.itemId)).innerJoin(locations, eq(locations.id, movements.locationId))
    .where(and(...conds)).orderBy(desc(movements.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const users = await ctx.people.names(page.map((r) => r.m.createdBy));
  return {
    data: page.map(({ m: { tenantId: _t, ...m }, ...r }) => ({ ...m, ...r, by: byLabel(m.createdBy, users) })),
    nextCursor: rows.length > q.limit ? page.at(-1)!.m.id : null,
  };
}

/** Items at or below their reorder point, with a suggested order quantity. */
export async function reorderList(ctx: ModuleContext) {
  const rows = await ctx.db.select({ i: items, total: totals }).from(items)
    .where(and(eq(items.archived, false), sql`${items.reorderPoint} is not null and ${totals} <= ${items.reorderPoint}`)).orderBy(asc(sql`lower(${items.name})`));
  return {
    currency: settingsOf(ctx).currency,
    data: rows.map((r) => {
      const onHand = Number(r.total);
      const suggest = r.i.reorderQty ?? Math.max(1, round3(r.i.reorderPoint! * 2 - onHand));
      return { id: r.i.id, sku: r.i.sku, name: r.i.name, unit: r.i.unit, onHand, reorderPoint: r.i.reorderPoint, suggestedQty: suggest, estCost: Math.round(suggest * r.i.cost) };
    }),
  };
}

export async function summary(ctx: ModuleContext) {
  const [r] = await ctx.db.select({
    items: sql<number>`count(*)::int`,
    value: sql<string>`coalesce(sum(${totals} * ${items.cost}), 0)`,
  }).from(items).where(eq(items.archived, false));
  const low = await reorderList(ctx);
  return { currency: settingsOf(ctx).currency, items: r!.items, stockValue: Math.round(Number(r!.value)), lowCount: low.data.length, low: low.data.slice(0, 5) };
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;   // no spreadsheet formulas
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function stockCsv(ctx: ModuleContext) {
  const rows = await ctx.db.select({ i: items, loc: locations.name, q: stock.quantity }).from(stock)
    .innerJoin(items, eq(items.id, stock.itemId)).innerJoin(locations, eq(locations.id, stock.locationId))
    .where(sql`${stock.quantity} <> 0`).orderBy(asc(items.sku), asc(locations.name));
  const cur = settingsOf(ctx).currency;
  let digits = 2;
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency: cur }).resolvedOptions().maximumFractionDigits ?? 2; } catch { /* keep 2 */ }
  const fmt = (minor: number) => (minor / 10 ** digits).toFixed(digits);
  const lines = [["SKU", "Item", "Location", "Quantity", "Unit", `Unit cost (${cur})`, `Value (${cur})`]];
  for (const r of rows) lines.push([r.i.sku, r.i.name, r.loc, String(r.q), r.i.unit, fmt(r.i.cost), fmt(Math.round(r.q * r.i.cost))]);
  return new TextEncoder().encode(`﻿${lines.map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`);
}

/** Workflow helper: find an active item by SKU. */
export async function itemBySku(ctx: ModuleContext, sku: string) {
  const [i] = await ctx.db.select().from(items).where(sql`lower(${items.sku}) = lower(${sku})`);
  if (!i) throw E.notFound(`Item ${sku}`);
  return i;
}
export async function defaultLocation(ctx: ModuleContext) {
  const [l] = await ctx.db.select().from(locations).where(eq(locations.archived, false)).orderBy(asc(locations.position), asc(locations.name)).limit(1);
  if (!l) throw E.unprocessable("No location");
  return l;
}
