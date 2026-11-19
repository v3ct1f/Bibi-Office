import type { ReactNode } from "react";
import { Building2, Contact as ContactIcon, ListTodo } from "lucide-react";
import { Badge, type JsonSchema } from "@office/ui";
import type { Company, Contact, Task } from "../../api/types.ts";
import { contactName, fmtDate } from "../../lib/format.ts";

type Values = Record<string, unknown>;
export interface EntityConfig<T extends { id: string }> {
  key: "contacts" | "companies" | "tasks";
  type: "contact" | "company" | "task";
  singular: string;
  plural: string;
  icon: typeof ListTodo;
  searchable: boolean;
  hasDetail: boolean;
  schema: JsonSchema;
  columns: { header: string; cell: (r: T) => ReactNode; className?: string }[];
  fields: { label: string; value: (r: T) => ReactNode }[];
  title: (r: T) => string;
  toForm: (r: T) => Values;
  fromForm: (v: Values) => Values;
}

const nullable = (type: string, extra: JsonSchema = {}): JsonSchema => ({ anyOf: [{ type, ...extra }, { type: "null" }] });
const muted = (v: ReactNode) => v || <span className="text-muted-foreground">—</span>;

export const STATUS: Record<Task["status"], { label: string; variant: "neutral" | "default" | "success" | "outline" }> = {
  open: { label: "Open", variant: "neutral" }, in_progress: { label: "In progress", variant: "default" },
  done: { label: "Done", variant: "success" }, cancelled: { label: "Cancelled", variant: "outline" },
};
const PRIORITY = ["Lowest", "Low", "Normal", "High", "Urgent"];

/** Strip empty strings so optional fields aren't sent as "". */
const clean = (v: Values) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === "" ? null : x]));

export const contactsConfig: EntityConfig<Contact> = {
  key: "contacts", type: "contact", singular: "contact", plural: "Contacts", icon: ContactIcon, searchable: true, hasDetail: true,
  schema: {
    type: "object",
    properties: {
      firstName: nullable("string", { maxLength: 200 }), lastName: nullable("string", { maxLength: 200 }),
      email: nullable("string", { format: "email", maxLength: 320 }), phone: nullable("string", { maxLength: 50 }),
    },
  },
  columns: [
    { header: "Name", cell: (c) => <span className="font-medium">{contactName(c)}</span> },
    { header: "Email", cell: (c) => muted(c.email), className: "hidden sm:table-cell" },
    { header: "Phone", cell: (c) => muted(c.phone), className: "hidden md:table-cell" },
    { header: "Added", cell: (c) => <span className="text-muted-foreground">{fmtDate(c.createdAt)}</span>, className: "hidden md:table-cell" },
  ],
  fields: [
    { label: "First name", value: (c) => muted(c.firstName) }, { label: "Last name", value: (c) => muted(c.lastName) },
    { label: "Email", value: (c) => c.email ? <a className="text-primary hover:underline" href={`mailto:${c.email}`}>{c.email}</a> : muted(null) },
    { label: "Phone", value: (c) => muted(c.phone) }, { label: "Created", value: (c) => fmtDate(c.createdAt) },
  ],
  title: contactName,
  toForm: (c) => ({ firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone }),
  fromForm: clean,
};

export const companiesConfig: EntityConfig<Company> = {
  key: "companies", type: "company", singular: "company", plural: "Companies", icon: Building2, searchable: true, hasDetail: true,
  schema: {
    type: "object", required: ["name"],
    properties: {
      name: { type: "string", minLength: 1, maxLength: 300 },
      domain: nullable("string", { maxLength: 253, description: "e.g. acme.com" }),
      taxId: nullable("string", { maxLength: 64, title: "Tax ID" }),
    },
  },
  columns: [
    { header: "Name", cell: (c) => <span className="font-medium">{c.name}</span> },
    { header: "Domain", cell: (c) => muted(c.domain), className: "hidden sm:table-cell" },
    { header: "Tax ID", cell: (c) => muted(c.taxId), className: "hidden md:table-cell" },
    { header: "Added", cell: (c) => <span className="text-muted-foreground">{fmtDate(c.createdAt)}</span>, className: "hidden md:table-cell" },
  ],
  fields: [
    { label: "Name", value: (c) => c.name }, { label: "Domain", value: (c) => muted(c.domain) },
    { label: "Tax ID", value: (c) => muted(c.taxId) }, { label: "Created", value: (c) => fmtDate(c.createdAt) },
  ],
  title: (c) => c.name,
  toForm: (c) => ({ name: c.name, domain: c.domain, taxId: c.taxId }),
  fromForm: clean,
};

export const tasksConfig: EntityConfig<Task> = {
  key: "tasks", type: "task", singular: "task", plural: "Tasks", icon: ListTodo, searchable: false, hasDetail: false,
  schema: {
    type: "object", required: ["title"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 500 },
      description: nullable("string", { maxLength: 20000 }),
      status: { type: "string", enum: ["open", "in_progress", "done", "cancelled"], default: "open" },
      priority: { type: "integer", minimum: 0, maximum: 4, default: 2, description: "0 lowest … 4 urgent" },
      dueAt: nullable("string", { format: "date", title: "Due date" }),
    },
  },
  columns: [
    { header: "Task", cell: (t) => <span className={t.status === "done" ? "text-muted-foreground line-through" : "font-medium"}>{t.title}</span> },
    { header: "Status", cell: (t) => <Badge variant={STATUS[t.status].variant}>{STATUS[t.status].label}</Badge> },
    { header: "Priority", cell: (t) => <span className={t.priority >= 3 ? "font-medium text-warning" : "text-muted-foreground"}>{PRIORITY[t.priority]}</span>, className: "hidden sm:table-cell" },
    { header: "Due", cell: (t) => <span className={t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "done" ? "text-destructive" : "text-muted-foreground"}>{fmtDate(t.dueAt)}</span>, className: "hidden md:table-cell" },
  ],
  fields: [],
  title: (t) => t.title,
  toForm: (t) => ({ title: t.title, description: t.description, status: t.status, priority: t.priority, dueAt: t.dueAt?.slice(0, 10) ?? null }),
  fromForm: (v) => clean({ ...v, priority: v.priority ?? 2 }),
};
