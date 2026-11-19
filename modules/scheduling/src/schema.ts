import { boolean, customType, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const tstzrange = customType<{ data: string }>({ dataType: () => "tstzrange" });

export const services = pgTable("scheduling_services", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  durationMin: integer("duration_min").notNull(),
  bufferMin: integer("buffer_min").notNull(),
  location: text("location"),
  isPublic: boolean("is_public").notNull(),
  active: boolean("active").notNull(),
  position: integer("position").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const serviceHosts = pgTable("scheduling_service_hosts", {
  tenantId: uuid("tenant_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  hostId: uuid("host_id").notNull(),
});

export const hours = pgTable("scheduling_hours", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  hostId: uuid("host_id").notNull(),
  weekday: smallint("weekday").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
});

export const timeOff = pgTable("scheduling_time_off", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  hostId: uuid("host_id").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  reason: text("reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type BookingStatus = "confirmed" | "cancelled" | "completed" | "no_show";
export const bookings = pgTable("scheduling_bookings", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  hostId: uuid("host_id").notNull(),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  blocked: tstzrange("blocked").notNull(),
  status: text("status").$type<BookingStatus>().notNull(),
  source: text("source").$type<"internal" | "public">().notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  notes: text("notes"),
  contactId: uuid("contact_id"),
  manageToken: bytea("manage_token"),
  cancelledAt: ts("cancelled_at"),
  cancelledBy: text("cancelled_by"),
  cancelReason: text("cancel_reason"),
  createdBy: text("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
