import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { moduleErrors as E, type ModuleContext } from "@office/sdk";
import { items, movements, orderLines, orders, REASONS, type OrderStatus, type Reason } from "./schema.ts";

export const P = {
  READ: "inventory:stock.read",          // see items, stock history and purchase orders
  ADJUST: "inventory:stock.adjust",      // record deliveries, usage, waste and counts
  MANAGE: "inventory:purchasing.manage", // add/edit items, create, send and receive purchase orders
} as const;

const OPEN: OrderStatus[] = ["draft", "sent"];
export const r3 = (n: number) => Math.round(n * 1000) / 1000;
export const lineTotal = (qty: number, cents: number) => Math.round(qty * cents);
export const orderNumber = (seq: number) => `PO-${String(seq).padStart(4, "0")}`;
export const currencyOf = (ctx: ModuleContext) => {
  const c = ctx.settings.get<{ currency?: string }>().currency;
  return c && /^[A-Z]{3}$/.test(c) ? c : "EUR";
};
const me = (ctx: ModuleContext) => ctx.actor.userId ?? null;
/** How much to order for a low item: the set reorder amount, else enough to get back to twice the minimum. */
export const suggestedQty = (i: { stock: number; minStock: number; reorderQty: number | null }) =>
  i.reorderQty ?? Math.max(1, Math.ceil(r3(2 * i.minStock - i.stock)));
export const isLow = (i: { stock: number; minStock: number }) => i.minStock > 0 && i.stock <= i.minStock;

// ───────── Validation ─────────
const text = (max: number) => z.string().trim().max(max);
const qty = (msg: string) => z.number({ error: msg }).finite().min(0, "Can't be negative").max(1_000_000_000, "That's too large")
  .refine((n) => Math.abs(r3(n) - n) < 1e-9, "Use at most 3 decimals");
const positiveQty = (msg: string) => qty(msg).refine((n) => n > 0, "Must be more than 0");
const cents = z.number().int("Use whole cents").min(0, "Can't be negative").max(100_000_000_00, "That's too large");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-03-01");

const itemFields = {
  name: text(120).min(1, "Give the item a name"),
  sku: text(60).nullish(),
  category: text(60).nullish(),
  unit: text(20).min(1, "Say how you count it, e.g. kg, bottle, box"),
  minStock: qty("Minimum stock must be a number"),
  reorderQty: positiveQty("Reorder amount must be a number").nullish(),
  supplierId: z.uuid("Choose a supplier").nullish(),
  unitCostCents: cents,
  notes: text(1000).nullish(),
};
export const ItemInput = z.object({ ...itemFields, stock: qty("Stock must be a number").default(0) }).strict();
export const ItemPatch = z.object({ ...itemFields, archived: z.boolean() }).partial().strict();
export const ItemQuery = z.object({
  q: text(100).optional(), category: text(60).optional(), supplierId: z.uuid().optional(),
  low: z.enum(["true", "false"]).optional(), archived: z.enum(["true", "false"]).optional(),
});
export const AdjustInput = z.object({
  reason: z.enum(REASONS, "Choose why the stock changed"),
  quantity: qty("Enter a quantity"),
  note: text(300).nullish(),
}).strict();
export const MovementQuery = z.object({
  itemId: z.uuid().optional(), reason: z.enum(REASONS).optional(), from: date.optional(), to: date.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0),
});
const LineInput = z.object({ itemId: z.uuid("Choose an item"), quantity: positiveQty("Enter a quantity"), unitCostCents: cents.optional() }).strict();
export const OrderInput = z.object({
  supplierId: z.uuid("Choose a supplier"), notes: text(1000).nullish(), expectedOn: date.nullish(), lines: z.array(LineInput).max(200).default([]),
}).strict();
export const OrderPatch = z.object({
  supplierId: z.uuid("Choose a supplier").optional(), notes: text(1000).nullish(), expectedOn: date.nullish(), lines: z.array(LineInput).max(200).optional(),
}).strict();
export const OrderQuery = z.object({ status: z.enum(["draft", "sent", "received", "cancelled", "open"]).optional() });
export const ReceiveInput = z.object({
  lines: z.array(z.object({ lineId: z.uuid(), receivedQty: qty("Enter what arrived") }).strict()).max(200).optional(),
  note: text(300).nullish(),
}).strict();

// ───────── Suppliers (core companies) ─────────
async function supplierNames(ctx: ModuleContext, ids: (string | null)[]) {
  const out = new Map<string, string>();
  for (const id of new Set(ids.filter((x): x is string => !!x))) {
    try { out.set(id, String((await ctx.data.companies.get(id)).name ?? "Unnamed company")); }
    catch { out.set(id, "Deleted company"); }
  }
  return out;
}
async function requireSupplier(ctx: ModuleContext, id: string | null | undefined) {
  if (!id) return;
  try { await ctx.data.companies.get(id); } catch { throw E.badRequest("That supplier doesn't exist. Add it under Companies first."); }
}
async function peopleNames(ctx: ModuleContext) {
  const people = await ctx.people.list();
  return (id: string | null) => (id ? people.find((p) => p.userId === id)?.name ?? "Former member" : null);
}

// ───────── Items ─────────
type ItemRow = typeof items.$inferSelect;
async function onOrder(ctx: ModuleContext, itemIds?: string[]) {
  if (itemIds && !itemIds.length) return new Map<string, number>();
  const rows = await ctx.db.select({ itemId: orderLines.itemId, q: sql<string>`sum(${orderLines.quantity})` })
    .from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(inArray(orders.status, OPEN), itemIds ? inArray(orderLines.itemId, itemIds) : undefined))
    .groupBy(orderLines.itemId);
  return new Map(rows.map((r) => [r.itemId, Number(r.q)]));
}
const itemDto = (i: ItemRow, suppliers: Map<string, string>, ordered: Map<string, number>) => ({
  id: i.id, name: i.name, sku: i.sku, category: i.category, unit: i.unit, stock: i.stock, minStock: i.minStock, reorderQty: i.reorderQty,
  supplierId: i.supplierId, supplierName: i.supplierId ? suppliers.get(i.supplierId) ?? null : null,
  unitCostCents: i.unitCostCents, valueCents: lineTotal(i.stock, i.unitCostCents), notes: i.notes, archived: i.archived,
  low: isLow(i), onOrder: ordered.get(i.id) ?? 0, suggestedQty: suggestedQty(i), updatedAt: i.updatedAt,
});

export async function listItems(ctx: ModuleContext, q: z.infer<typeof ItemQuery>) {
  const conds: (SQL | undefined)[] = [eq(items.archived, q.archived === "true")];
  if (q.q) conds.push(or(ilike(items.name, `%${q.q}%`), ilike(items.sku, `%${q.q}%`)));
  if (q.category) conds.push(eq(items.category, q.category));
  if (q.supplierId) conds.push(eq(items.supplierId, q.supplierId));
  if (q.low === "true") conds.push(sql`${items.minStock} > 0 AND ${items.stock} <= ${items.minStock}`);
  const rows = await ctx.db.select().from(items).where(and(...conds)).orderBy(asc(sql`lower(${items.name})`)).limit(500);
  const [suppliers, ordered] = await Promise.all([supplierNames(ctx, rows.map((r) => r.supplierId)), onOrder(ctx, rows.map((r) => r.id))]);
  const data = rows.map((r) => itemDto(r, suppliers, ordered));
  return { data, lowCount: data.filter((d) => d.low).length, valueCents: data.reduce((a, d) => a + d.valueCents, 0), currency: currencyOf(ctx) };
}

async function loadItem(ctx: ModuleContext, id: string) {
  const [i] = await ctx.db.select().from(items).where(eq(items.id, id));
  if (!i) throw E.notFound("Item");
  return i;
}
export async function getItem(ctx: ModuleContext, id: string) {
  const i = await loadItem(ctx, id);
  const [suppliers, ordered] = await Promise.all([supplierNames(ctx, [i.supplierId]), onOrder(ctx, [i.id])]);
  const openOrders = await ctx.db.select({ id: orders.id, seq: orders.seq, status: orders.status, quantity: orderLines.quantity })
    .from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orderLines.itemId, id), inArray(orders.status, OPEN))).orderBy(asc(orders.seq));
  const history = await listMovements(ctx, { itemId: id, limit: 100, offset: 0 });
  return {
    ...itemDto(i, suppliers, ordered),
    openOrders: openOrders.map((o) => ({ id: o.id, number: orderNumber(o.seq), status: o.status, quantity: o.quantity })),
    history: history.data,
  };
}

async function checkUnique(ctx: ModuleContext, f: { name?: string | undefined; sku?: string | null | undefined }, ignore?: string) {
  const not = ignore ? ne(items.id, ignore) : undefined;
  if (f.name) {
    const [d] = await ctx.db.select({ id: items.id }).from(items).where(and(eq(items.archived, false), sql`lower(${items.name}) = lower(${f.name})`, not));
    if (d) throw E.conflict(`There is already an item called “${f.name}”`);
  }
  if (f.sku) {
    const [d] = await ctx.db.select({ name: items.name }).from(items).where(and(eq(items.archived, false), sql`lower(${items.sku}) = lower(${f.sku})`, not));
    if (d) throw E.conflict(`SKU ${f.sku} is already used by “${d.name}”`);
  }
}

export async function createItem(ctx: ModuleContext, input: z.infer<typeof ItemInput>) {
  await checkUnique(ctx, input);
  await requireSupplier(ctx, input.supplierId);
  const id = uuidv7();
  await ctx.db.insert(items).values({
    id, tenantId: ctx.tenantId, name: input.name, sku: input.sku || null, category: input.category || null, unit: input.unit,
    stock: r3(input.stock), minStock: r3(input.minStock), reorderQty: input.reorderQty ?? null, supplierId: input.supplierId ?? null,
    unitCostCents: input.unitCostCents, notes: input.notes || null, archived: false,
  });
  if (input.stock > 0) {
    await ctx.db.insert(movements).values({
      id: uuidv7(), tenantId: ctx.tenantId, itemId: id, reason: "count", delta: r3(input.stock), stockAfter: r3(input.stock), note: "Starting stock", actorId: me(ctx),
    });
  }
  await ctx.audit.log("item.created", { type: "item", id }, { name: input.name, stock: input.stock });
  return getItem(ctx, id);
}

export async function updateItem(ctx: ModuleContext, id: string, patch: z.infer<typeof ItemPatch>) {
  const i = await loadItem(ctx, id);
  const willBeActive = patch.archived === undefined ? !i.archived : !patch.archived;
  if (willBeActive) await checkUnique(ctx, { name: patch.name ?? i.name, sku: patch.sku === undefined ? i.sku : patch.sku }, id);
  if (patch.supplierId !== undefined) await requireSupplier(ctx, patch.supplierId);
  if (patch.archived === true) await refuseIfOnOrder(ctx, id);
  const set: Partial<typeof items.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.sku !== undefined) set.sku = patch.sku || null;
  if (patch.category !== undefined) set.category = patch.category || null;
  if (patch.unit !== undefined) set.unit = patch.unit;
  if (patch.minStock !== undefined) set.minStock = r3(patch.minStock);
  if (patch.reorderQty !== undefined) set.reorderQty = patch.reorderQty ?? null;
  if (patch.supplierId !== undefined) set.supplierId = patch.supplierId ?? null;
  if (patch.unitCostCents !== undefined) set.unitCostCents = patch.unitCostCents;
  if (patch.notes !== undefined) set.notes = patch.notes || null;
  if (patch.archived !== undefined) set.archived = patch.archived;
  await ctx.db.update(items).set(set).where(eq(items.id, id));
  await ctx.audit.log(patch.archived === true ? "item.archived" : patch.archived === false ? "item.restored" : "item.updated", { type: "item", id }, { changes: Object.keys(patch) });
  return getItem(ctx, id);
}

async function refuseIfOnOrder(ctx: ModuleContext, itemId: string) {
  const [o] = await ctx.db.select({ seq: orders.seq }).from(orderLines).innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(eq(orderLines.itemId, itemId), inArray(orders.status, OPEN))).limit(1);
  if (o) throw E.conflict(`It's on open purchase order ${orderNumber(o.seq)}. Receive or cancel that order first.`);
}

/** Items are never deleted (history and orders point at them); this archives them. */
export async function archiveItem(ctx: ModuleContext, id: string) {
  await updateItem(ctx, id, { archived: true });
}

// ───────── Stock changes ─────────
const REASON_WORD: Record<Reason, string> = { delivery: "Delivery", usage: "Usage", waste: "Waste", count: "Count correction" };

/** Locks the item, applies the change, logs it, and emits a low-stock event when it drops to or below the minimum. */
async function applyChange(ctx: ModuleContext, itemId: string, reason: Reason, change: { delta?: number; absolute?: number }, note: string | null, orderId: string | null = null) {
  const [i] = await ctx.db.select().from(items).where(eq(items.id, itemId)).for("update");
  if (!i) throw E.notFound("Item");
  const after = r3(change.absolute ?? i.stock + (change.delta ?? 0));
  const delta = r3(after - i.stock);
  if (after < 0) throw E.conflict(`Only ${i.stock} ${i.unit} of ${i.name} in stock, so you can't take ${Math.abs(change.delta ?? 0)}`);
  if (delta === 0 && reason === "count") throw E.badRequest(`The stock is already ${after} ${i.unit}`);
  await ctx.db.update(items).set({ stock: after, updatedAt: new Date() }).where(eq(items.id, itemId));
  const id = uuidv7();
  await ctx.db.insert(movements).values({ id, tenantId: ctx.tenantId, itemId, reason, delta, stockAfter: after, note, orderId, actorId: me(ctx) });
  await ctx.events.emit("inventory.stock.changed", { itemId, name: i.name, reason, delta, stock: after, unit: i.unit });
  if (i.minStock > 0 && after <= i.minStock && i.stock > i.minStock) {
    await ctx.events.emit("inventory.stock.low", { itemId, name: i.name, stock: after, minStock: i.minStock, unit: i.unit, supplierId: i.supplierId });
  }
  return { before: i.stock, after, delta };
}

export async function adjust(ctx: ModuleContext, itemId: string, input: z.infer<typeof AdjustInput>) {
  const i = await loadItem(ctx, itemId);
  if (i.archived) throw E.conflict(`${i.name} is archived. Restore it to change its stock.`);
  if (input.reason !== "count" && input.quantity <= 0) throw E.badRequest("Enter a quantity more than 0");
  const sign = input.reason === "delivery" ? 1 : -1;
  const change = input.reason === "count" ? { absolute: input.quantity } : { delta: sign * input.quantity };
  await applyChange(ctx, itemId, input.reason, change, input.note || null);
  await ctx.audit.log(`stock.${input.reason}`, { type: "item", id: itemId }, { quantity: input.quantity });
  return getItem(ctx, itemId);
}

export async function listMovements(ctx: ModuleContext, q: Partial<z.infer<typeof MovementQuery>> & { limit: number; offset: number }) {
  const where = and(
    q.itemId ? eq(movements.itemId, q.itemId) : undefined, q.reason ? eq(movements.reason, q.reason) : undefined,
    q.from ? gte(movements.createdAt, new Date(`${q.from}T00:00:00Z`)) : undefined,
    q.to ? sql`${movements.createdAt} < (${q.to}::date + 1)` : undefined,
  );
  const rows = await ctx.db.select({ m: movements, name: items.name, unit: items.unit, seq: orders.seq })
    .from(movements).innerJoin(items, eq(items.id, movements.itemId)).leftJoin(orders, eq(orders.id, movements.orderId))
    .where(where).orderBy(desc(movements.createdAt), desc(movements.id)).limit(q.limit).offset(q.offset);
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(movements).where(where) as [{ n: number }];
  const name = await peopleNames(ctx);
  return {
    total: n,
    data: rows.map(({ m, ...r }) => ({
      id: m.id, itemId: m.itemId, itemName: r.name, unit: r.unit, reason: m.reason, reasonLabel: REASON_WORD[m.reason], delta: m.delta,
      stockAfter: m.stockAfter, note: m.note, orderId: m.orderId, orderNumber: r.seq ? orderNumber(r.seq) : null,
      actorName: name(m.actorId), at: m.createdAt,
    })),
  };
}

// ───────── Purchase orders ─────────
type OrderRow = typeof orders.$inferSelect;
async function orderDetail(ctx: ModuleContext, o: OrderRow) {
  const lines = await ctx.db.select({ l: orderLines, name: items.name, unit: items.unit, sku: items.sku })
    .from(orderLines).innerJoin(items, eq(items.id, orderLines.itemId)).where(eq(orderLines.orderId, o.id)).orderBy(asc(orderLines.position));
  const suppliers = await supplierNames(ctx, [o.supplierId]);
  const name = await peopleNames(ctx);
  const ls = lines.map(({ l, ...i }) => ({
    id: l.id, itemId: l.itemId, itemName: i.name, unit: i.unit, sku: i.sku, quantity: l.quantity, unitCostCents: l.unitCostCents,
    totalCents: lineTotal(l.quantity, l.unitCostCents), receivedQty: l.receivedQty,
  }));
  return {
    ...orderSummary(o, suppliers, ls.length, ls.reduce((a, l) => a + l.totalCents, 0)),
    notes: o.notes, createdByName: name(o.createdBy), receivedByName: name(o.receivedBy), lines: ls,
    can: { edit: OPEN.includes(o.status), send: o.status === "draft" && ls.length > 0, receive: OPEN.includes(o.status) && ls.length > 0, cancel: OPEN.includes(o.status), delete: o.status === "draft" },
  };
}
const orderSummary = (o: OrderRow, suppliers: Map<string, string>, lineCount: number, totalCents: number) => ({
  id: o.id, number: orderNumber(o.seq), supplierId: o.supplierId, supplierName: suppliers.get(o.supplierId) ?? null, status: o.status,
  currency: o.currency, expectedOn: o.expectedOn, lineCount, totalCents, createdAt: o.createdAt, sentAt: o.sentAt, receivedAt: o.receivedAt,
});

export async function listOrders(ctx: ModuleContext, q: z.infer<typeof OrderQuery>) {
  const rows = await ctx.db.select({
    o: orders, n: sql<number>`count(${orderLines.id})::int`,
    total: sql<string>`coalesce(sum(round(${orderLines.quantity} * ${orderLines.unitCostCents})), 0)`,
  }).from(orders).leftJoin(orderLines, eq(orderLines.orderId, orders.id))
    .where(q.status === "open" ? inArray(orders.status, OPEN) : q.status ? eq(orders.status, q.status) : undefined)
    .groupBy(orders.id).orderBy(desc(orders.seq)).limit(300);
  const suppliers = await supplierNames(ctx, rows.map((r) => r.o.supplierId));
  return rows.map((r) => orderSummary(r.o, suppliers, r.n, Number(r.total)));
}

async function loadOrder(ctx: ModuleContext, id: string) {
  const [o] = await ctx.db.select().from(orders).where(eq(orders.id, id));
  if (!o) throw E.notFound("Purchase order");
  return o;
}
export const getOrder = async (ctx: ModuleContext, id: string) => orderDetail(ctx, await loadOrder(ctx, id));

async function writeLines(ctx: ModuleContext, orderId: string, lines: z.infer<typeof LineInput>[]) {
  const ids = lines.map((l) => l.itemId);
  if (new Set(ids).size !== ids.length) throw E.badRequest("An item is on the order twice. Combine them into one line.");
  const found = ids.length ? await ctx.db.select().from(items).where(inArray(items.id, ids)) : [];
  for (const l of lines) {
    const i = found.find((x) => x.id === l.itemId);
    if (!i) throw E.badRequest("One of the items doesn't exist");
    if (i.archived) throw E.badRequest(`${i.name} is archived`);
  }
  await ctx.db.delete(orderLines).where(eq(orderLines.orderId, orderId));
  if (lines.length) {
    await ctx.db.insert(orderLines).values(lines.map((l, n) => ({
      id: uuidv7(), tenantId: ctx.tenantId, orderId, itemId: l.itemId, position: n, quantity: r3(l.quantity),
      unitCostCents: l.unitCostCents ?? found.find((x) => x.id === l.itemId)!.unitCostCents,
    })));
  }
}

async function insertOrder(ctx: ModuleContext, input: { supplierId: string; notes?: string | null; expectedOn?: string | null }) {
  const [{ next }] = await ctx.db.select({ next: sql<number>`coalesce(max(${orders.seq}), 0)::int + 1` }).from(orders) as [{ next: number }];
  const id = uuidv7();
  await ctx.db.insert(orders).values({
    id, tenantId: ctx.tenantId, seq: next, supplierId: input.supplierId, status: "draft", currency: currencyOf(ctx),
    notes: input.notes || null, expectedOn: input.expectedOn ?? null, createdBy: me(ctx),
  });
  return { id, number: orderNumber(next) };
}

export async function createOrder(ctx: ModuleContext, input: z.infer<typeof OrderInput>) {
  await requireSupplier(ctx, input.supplierId);
  const o = await insertOrder(ctx, input);
  await writeLines(ctx, o.id, input.lines);
  await ctx.events.emit("inventory.order.created", { id: o.id, number: o.number, supplierId: input.supplierId });
  await ctx.audit.log("order.created", { type: "purchase_order", id: o.id });
  return getOrder(ctx, o.id);
}

export async function updateOrder(ctx: ModuleContext, id: string, patch: z.infer<typeof OrderPatch>) {
  const o = await loadOrder(ctx, id);
  if (!OPEN.includes(o.status)) throw E.conflict(`${orderNumber(o.seq)} is ${o.status} and can't be changed`);
  if (patch.supplierId) await requireSupplier(ctx, patch.supplierId);
  if (patch.lines) {
    if (o.status === "sent" && !patch.lines.length) throw E.badRequest("A sent order needs at least one line. Cancel it instead.");
    await writeLines(ctx, id, patch.lines);
  }
  await ctx.db.update(orders).set({
    updatedAt: new Date(),
    ...(patch.supplierId ? { supplierId: patch.supplierId } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
    ...(patch.expectedOn !== undefined ? { expectedOn: patch.expectedOn ?? null } : {}),
  }).where(eq(orders.id, id));
  await ctx.audit.log("order.updated", { type: "purchase_order", id }, { changes: Object.keys(patch) });
  return getOrder(ctx, id);
}

/** One draft order per supplier for every low item that isn't already on an open order. */
export async function generateOrders(ctx: ModuleContext) {
  const low = await ctx.db.select().from(items)
    .where(and(eq(items.archived, false), sql`${items.minStock} > 0 AND ${items.stock} <= ${items.minStock}`)).orderBy(asc(items.name));
  const ordered = await onOrder(ctx, low.map((i) => i.id));
  const skipped: { itemId: string; name: string; reason: string }[] = [];
  const bySupplier = new Map<string, typeof low>();
  for (const i of low) {
    if (ordered.has(i.id)) { skipped.push({ itemId: i.id, name: i.name, reason: "already on an open order" }); continue; }
    if (!i.supplierId) { skipped.push({ itemId: i.id, name: i.name, reason: "has no supplier" }); continue; }
    bySupplier.set(i.supplierId, [...(bySupplier.get(i.supplierId) ?? []), i]);
  }
  const names = await supplierNames(ctx, [...bySupplier.keys()]);
  const created: { id: string; number: string; supplierName: string | null; lineCount: number }[] = [];
  for (const [supplierId, list] of bySupplier) {
    if (names.get(supplierId) === "Deleted company") {
      for (const i of list) skipped.push({ itemId: i.id, name: i.name, reason: "its supplier was deleted" });
      continue;
    }
    const o = await insertOrder(ctx, { supplierId, notes: "Generated from low stock" });
    await writeLines(ctx, o.id, list.map((i) => ({ itemId: i.id, quantity: suggestedQty(i), unitCostCents: i.unitCostCents })));
    await ctx.events.emit("inventory.order.created", { id: o.id, number: o.number, supplierId, generated: true });
    created.push({ ...o, supplierName: names.get(supplierId) ?? null, lineCount: list.length });
  }
  if (created.length) await ctx.audit.log("orders.generated", undefined, { orders: created.map((c) => c.number) });
  return { created, skipped };
}

/** Moves an order between statuses only if it is still in an expected one (guards double clicks and races). */
async function transition(ctx: ModuleContext, id: string, from: OrderStatus[], set: Partial<typeof orders.$inferInsert>) {
  const o = await loadOrder(ctx, id);
  const r = await ctx.db.update(orders).set({ ...set, updatedAt: new Date() })
    .where(and(eq(orders.id, id), inArray(orders.status, from))).returning();
  if (!r.length) throw E.conflict(`${orderNumber(o.seq)} is ${o.status}, so it can't be ${set.status === "sent" ? "sent" : set.status}`);
  return r[0]!;
}

export async function sendOrder(ctx: ModuleContext, id: string) {
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(orderLines).where(eq(orderLines.orderId, id)) as [{ n: number }];
  if (!n) { await loadOrder(ctx, id); throw E.badRequest("Add at least one item before sending the order"); }
  const o = await transition(ctx, id, ["draft"], { status: "sent", sentAt: new Date() });
  await ctx.events.emit("inventory.order.sent", { id, number: orderNumber(o.seq), supplierId: o.supplierId });
  await ctx.audit.log("order.sent", { type: "purchase_order", id });
  return getOrder(ctx, id);
}

export async function receiveOrder(ctx: ModuleContext, id: string, input: z.infer<typeof ReceiveInput>) {
  const lines = await ctx.db.select().from(orderLines).where(eq(orderLines.orderId, id)).orderBy(asc(orderLines.position));
  if (!lines.length) { await loadOrder(ctx, id); throw E.badRequest("This order has no items to receive"); }
  for (const g of input.lines ?? []) if (!lines.some((l) => l.id === g.lineId)) throw E.badRequest("A received line isn't on this order");
  const o = await transition(ctx, id, ["draft", "sent"], { status: "received", receivedAt: new Date(), receivedBy: me(ctx) });
  const number = orderNumber(o.seq);
  let units = 0;
  for (const l of lines) {
    const got = r3(input.lines?.find((g) => g.lineId === l.id)?.receivedQty ?? l.quantity);
    await ctx.db.update(orderLines).set({ receivedQty: got }).where(eq(orderLines.id, l.id));
    if (got > 0) {
      await applyChange(ctx, l.itemId, "delivery", { delta: got }, `Received${input.note ? `: ${input.note}` : ""}`, id);
      // The last price paid becomes the item's cost.
      await ctx.db.update(items).set({ unitCostCents: l.unitCostCents }).where(eq(items.id, l.itemId));
      units++;
    }
  }
  await ctx.events.emit("inventory.order.received", { id, number, supplierId: o.supplierId, itemsReceived: units });
  await ctx.audit.log("order.received", { type: "purchase_order", id }, { lines: lines.length, itemsReceived: units });
  return getOrder(ctx, id);
}

export async function cancelOrder(ctx: ModuleContext, id: string) {
  await transition(ctx, id, ["draft", "sent"], { status: "cancelled" });
  await ctx.audit.log("order.cancelled", { type: "purchase_order", id });
  return getOrder(ctx, id);
}

export async function deleteOrder(ctx: ModuleContext, id: string) {
  const o = await loadOrder(ctx, id);
  if (o.status !== "draft") throw E.conflict(`Only drafts can be deleted. ${orderNumber(o.seq)} is ${o.status}; cancel it instead.`);
  await ctx.db.delete(orders).where(eq(orders.id, id));
  await ctx.audit.log("order.deleted", { type: "purchase_order", id }, { number: orderNumber(o.seq) });
}

// ───────── Dashboard / config ─────────
export async function summary(ctx: ModuleContext) {
  const low = await ctx.db.select().from(items)
    .where(and(eq(items.archived, false), sql`${items.minStock} > 0 AND ${items.stock} <= ${items.minStock}`))
    .orderBy(sql`${items.stock} / ${items.minStock}`, asc(items.name));
  const ordered = await onOrder(ctx, low.map((i) => i.id));
  const open = await ctx.db.select({ status: orders.status, n: sql<number>`count(*)::int` }).from(orders)
    .where(inArray(orders.status, OPEN)).groupBy(orders.status);
  return {
    lowCount: low.length,
    notOrdered: low.filter((i) => !ordered.has(i.id)).length,
    low: low.slice(0, 6).map((i) => ({ id: i.id, name: i.name, unit: i.unit, stock: i.stock, minStock: i.minStock, onOrder: ordered.get(i.id) ?? 0 })),
    drafts: open.find((o) => o.status === "draft")?.n ?? 0,
    sent: open.find((o) => o.status === "sent")?.n ?? 0,
  };
}

export async function config(ctx: ModuleContext) {
  const cats = await ctx.db.selectDistinct({ c: items.category }).from(items).where(and(isNotNull(items.category), eq(items.archived, false)));
  const units = await ctx.db.selectDistinct({ u: items.unit }).from(items);
  const defaults = ["unit", "kg", "g", "l", "ml", "bottle", "box", "case", "pack"];
  return {
    currency: currencyOf(ctx), me: me(ctx), canAdjust: ctx.authz.can(P.ADJUST), canManage: ctx.authz.can(P.MANAGE),
    categories: cats.map((c) => c.c!).sort((a, b) => a.localeCompare(b)),
    units: [...new Set([...defaults, ...units.map((u) => u.u)])],
  };
}

export async function suppliers(ctx: ModuleContext) {
  const rows = await ctx.db.selectDistinct({ id: items.supplierId }).from(items).where(isNotNull(items.supplierId));
  const names = await supplierNames(ctx, rows.map((r) => r.id));
  return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}
