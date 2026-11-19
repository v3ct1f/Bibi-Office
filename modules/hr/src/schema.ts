import { boolean, customType, date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (n: string) => timestamp(n, { withTimezone: true });
const day = (n: string) => date(n, { mode: "string" });
/** numeric(5,1) as a JS number */
const num = customType<{ data: number; driverData: string }>({ dataType: () => "numeric(5,1)", fromDriver: (v) => Number(v), toDriver: (v) => String(v) });

export type EmploymentType = "full_time" | "part_time" | "contractor" | "intern";
export const employees = pgTable("hr_employees", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  userId: uuid("user_id"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  workEmail: text("work_email"),
  jobTitle: text("job_title"),
  department: text("department"),
  managerId: uuid("manager_id"),
  employmentType: text("employment_type").$type<EmploymentType>().notNull(),
  startDate: day("start_date").notNull(),
  endDate: day("end_date"),
  annualAllowance: num("annual_allowance"),
  birthDate: day("birth_date"),
  phone: text("phone"),
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const leaveTypes = pgTable("hr_leave_types", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  name: text("name").notNull(),
  usesAllowance: boolean("uses_allowance").notNull(),
  needsApproval: boolean("needs_approval").notNull(),
  paid: boolean("paid").notNull(),
  position: integer("position").notNull(),
  archived: boolean("archived").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const holidays = pgTable("hr_holidays", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  day: day("day").notNull(),
  name: text("name").notNull(),
});

export type LeaveStatus = "requested" | "approved" | "rejected" | "cancelled";
export const leaveRequests = pgTable("hr_leave_requests", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  typeId: uuid("type_id").notNull(),
  startDate: day("start_date").notNull(),
  endDate: day("end_date").notNull(),
  halfDay: boolean("half_day").notNull(),
  days: num("days").notNull(),
  status: text("status").$type<LeaveStatus>().notNull(),
  note: text("note"),
  requestedBy: text("requested_by").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type DocKind = "contract" | "identity" | "certificate" | "review" | "other";
export const hrDocuments = pgTable("hr_documents", {
  id: uuid("id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  documentId: uuid("document_id").notNull(),
  kind: text("kind").$type<DocKind>().notNull(),
  title: text("title").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type Employee = typeof employees.$inferSelect;
export type LeaveRequest = typeof leaveRequests.$inferSelect;
export type LeaveType = typeof leaveTypes.$inferSelect;
