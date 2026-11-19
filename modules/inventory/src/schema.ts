// Mirrors migrations/0001_init.sql (SQL is the source of truth).
import { boolean, date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
/** numeric(14,3) read and written as a JS number. */
const qty = (n: string) => numeric(n, { precision: 14, scale: 3, mode: "number" });

export const REASONS = ["delivery", "usage", "waste", "count"] as const;
export type Reason = (typeof REASONS)[number];
export const ORDER_STATUSES = ["draft", "sent", "received", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const items = pgTable("inventory_items", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  sku: text("sku"),
  category: text("category"),
  unit: text("unit").notNull(),
  stock: qty("stock").notNull(),
  minStock: qty("min_stock").notNull(),
  reorderQty: qty("reorder_qty"),
  supplierId: uuid("supplier_id"),
  unitCostCents: integer("unit_cost_cents").notNull(),
  notes: text("notes"),
  archived: boolean("archived").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const orders = pgTable("inventory_orders", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  seq: integer("seq").notNull(),
  supplierId: uuid("supplier_id").notNull(),
  status: text("status").$type<OrderStatus>().notNull(),
  currency: text("currency").notNull(),
  notes: text("notes"),
  expectedOn: date("expected_on"),
  createdBy: uuid("created_by"),
  sentAt: ts("sent_at"),
  receivedAt: ts("received_at"),
  receivedBy: uuid("received_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const orderLines = pgTable("inventory_order_lines", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  orderId: uuid("order_id").notNull(),
  itemId: uuid("item_id").notNull(),
  position: integer("position").notNull(),
  quantity: qty("quantity").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  receivedQty: qty("received_qty"),
});

export const movements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemId: uuid("item_id").notNull(),
  reason: text("reason").$type<Reason>().notNull(),
  delta: qty("delta").notNull(),
  stockAfter: qty("stock_after").notNull(),
  note: text("note"),
  orderId: uuid("order_id"),
  actorId: uuid("actor_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});
