import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type View = "number" | "line" | "bar";
export interface Tile { id: string; metric: string; view: View; target: number | null }
export const dashboards = pgTable("kpi_dashboards", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull(),
  tiles: jsonb("tiles").$type<Tile[]>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Dashboard = typeof dashboards.$inferSelect;
