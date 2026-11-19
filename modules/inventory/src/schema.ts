import { bigint, boolean, customType, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
/** numeric(14,3) as a JS number */
const qty = customType<{ data: number; driverData: string }>({ dataType: () => "numeric(14,3)", fromDriver: (v) => Number(v), toDriver: (v) => String(v) });
const money = (n: string) => bigint(n, { mode: "number" });

export const items = pgTable("inventory_items", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  unit: text("unit").notNull(),
  barcode: text("barcode"),
  cost: money("cost").notNull(),
  price: money("price"),
  reorderPoint: qty("reorder_point"),
  reorderQty: qty("reorder_qty"),
  archived: boolean("archived").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const locations = pgTable("inventory_locations", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  archived: boolean("archived").notNull(),
  position: integer("position").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type MovementKind = "receipt" | "issue" | "adjustment" | "transfer_out" | "transfer_in" | "count";
export const movements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  itemId: uuid("item_id").notNull(),
  locationId: uuid("location_id").notNull(),
  kind: text("kind").$type<MovementKind>().notNull(),
  quantity: qty("quantity").notNull(),
  unitCost: money("unit_cost"),
  groupId: uuid("group_id").notNull(),
  reference: text("reference"),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const stock = pgTable("inventory_stock", {
  tenantId: uuid("tenant_id").notNull(),
  itemId: uuid("item_id").notNull(),
  locationId: uuid("location_id").notNull(),
  quantity: qty("quantity").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export type Item = typeof items.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Movement = typeof movements.$inferSelect;
