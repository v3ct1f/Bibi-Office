import { and, desc, eq, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import { companies, contacts, documents, tasks, uuidv7, type Tx } from "@office/db";
import { notFound, badRequest } from "./errors.ts";
import { requirePermission } from "./permissions.ts";
import { audit, diffFields } from "./audit.ts";
import { emitEvent } from "./events.ts";
import type { RequestContext } from "./context.ts";

type EntityTable = PgTable & {
  id: PgColumn; tenantId: PgColumn; deletedAt: PgColumn;
};

export interface EntityDef<C extends z.ZodType, U extends z.ZodType> {
  name: string;            // singular, used in events/audit: contact
  plural: string;          // route segment + permission: contacts
  table: EntityTable;
  create: C;
  update: U;
  searchable?: boolean;    // has generated tsvector "search" column
  /** Hidden from API output. */
  hidden?: string[];
}

const custom = z.record(z.string().max(64), z.unknown()).refine((v) => JSON.stringify(v).length <= 16_384, "custom too large");
const email = z.string().trim().toLowerCase().email().max(320);
const uuid = z.uuid();

const contactBase = {
  companyId: uuid.nullable(),
  firstName: z.string().trim().max(200).nullable(),
  lastName: z.string().trim().max(200).nullable(),
  email: email.nullable(),
  phone: z.string().trim().max(50).nullable(),
  custom,
};
const companyBase = {
  name: z.string().trim().min(1).max(300),
  domain: z.string().trim().toLowerCase().max(253).nullable(),
  taxId: z.string().trim().max(64).nullable(),
  address: z.record(z.string(), z.unknown()).nullable(),
  custom,
};
const documentBase = {
  title: z.string().trim().min(1).max(300),
  folder: z.string().regex(/^\/[^\0]{0,500}$/),
  mime: z.string().max(200).nullable(),
  custom,
};
const taskBase = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20_000).nullable(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]),
  priority: z.number().int().min(0).max(4),
  dueAt: z.coerce.date().nullable(),
  assigneeId: uuid.nullable(),
  custom,
};

const partialOf = <T extends z.ZodRawShape>(s: T) => z.object(s).partial().strict();

export const ENTITIES = {
  contacts: {
    name: "contact", plural: "contacts", table: contacts as EntityTable, searchable: true,
    create: partialOf(contactBase).refine((v) => v.firstName || v.lastName || v.email, "firstName, lastName or email required"),
    update: partialOf(contactBase),
  },
  companies: {
    name: "company", plural: "companies", table: companies as EntityTable, searchable: true,
    create: z.object(companyBase).partial().required({ name: true }).strict(),
    update: partialOf(companyBase),
  },
  documents: {
    name: "document", plural: "documents", table: documents as EntityTable,
    create: z.object(documentBase).partial().required({ title: true }).strict(),
    update: partialOf(documentBase),
  },
  tasks: {
    name: "task", plural: "tasks", table: tasks as EntityTable,
    create: z.object(taskBase).partial().required({ title: true }).strict(),
    update: partialOf(taskBase),
  },
} satisfies Record<string, EntityDef<z.ZodType, z.ZodType>>;

export type EntityKey = keyof typeof ENTITIES;

const strip = (row: Record<string, unknown>) => {
  const { tenantId: _t, deletedAt: _d, search: _s, ...rest } = row;
  return rest;
};

export interface ListQuery { limit: number; cursor?: string | undefined; q?: string | undefined }

/** Generic tenant-scoped CRUD with permission check, audit and outbox event on every write. */
export function entityService(key: EntityKey) {
  const def = ENTITIES[key] as EntityDef<z.ZodType, z.ZodType>;
  const t = def.table;
  const live = (id: string): SQL => and(eq(t.id, id), isNull(t.deletedAt))!;
  const perm = (a: "read" | "write") => `core:${def.plural}.${a}`;

  return {
    def,
    async list(tx: Tx, ctx: RequestContext, q: ListQuery) {
      requirePermission(ctx, perm("read"));
      const where: SQL[] = [isNull(t.deletedAt)];
      if (q.cursor) where.push(lt(t.id, q.cursor));
      if (q.q && def.searchable) {
        // Whole-word/phrase match OR prefix match on every word ("init" finds "Initech").
        // Prefix terms are letters/digits only, so user input can never inject tsquery syntax.
        const terms = q.q.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
        const prefix = terms.map((w) => `${w}:*`).join(" & ");
        where.push(prefix
          ? sql`(search @@ websearch_to_tsquery('simple', ${q.q}) OR search @@ to_tsquery('simple', ${prefix}))`
          : sql`search @@ websearch_to_tsquery('simple', ${q.q})`);
      }
      const rows = await tx.select().from(t).where(and(...where)).orderBy(desc(t.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit) as Record<string, unknown>[];
      return { data: page.map(strip), nextCursor: rows.length > q.limit ? (page.at(-1)!.id as string) : null };
    },

    async get(tx: Tx, ctx: RequestContext, id: string) {
      requirePermission(ctx, perm("read"));
      const [row] = await tx.select().from(t).where(live(id));
      if (!row) throw notFound(def.name);
      return strip(row as Record<string, unknown>);
    },

    async create(tx: Tx, ctx: RequestContext, input: unknown) {
      requirePermission(ctx, perm("write"));
      const data = parse(def.create, input) as Record<string, unknown>;
      const id = uuidv7();
      const [row] = await tx.insert(t)
        .values({ ...data, id, tenantId: ctx.tenantId, createdBy: ctx.actor.userId ?? null } as never)
        .returning();
      const out = strip(row as Record<string, unknown>);
      await audit(tx, ctx, `${def.name}.created`, { type: def.name, id }, data);
      await emitEvent(tx, ctx, `core.${def.name}.created`, out);
      return out;
    },

    async update(tx: Tx, ctx: RequestContext, id: string, input: unknown) {
      requirePermission(ctx, perm("write"));
      const data = parse(def.update, input) as Record<string, unknown>;
      const [before] = await tx.select().from(t).where(live(id)).for("update");
      if (!before) throw notFound(def.name);
      if (!Object.keys(data).length) return strip(before as Record<string, unknown>);
      const [row] = await tx.update(t).set(data as never).where(live(id)).returning();
      const out = strip(row as Record<string, unknown>);
      const diff = diffFields(before as Record<string, unknown>, out);
      if (Object.keys(diff).length) {
        await audit(tx, ctx, `${def.name}.updated`, { type: def.name, id }, diff);
        await emitEvent(tx, ctx, `core.${def.name}.updated`, { id, changes: diff });
      }
      return out;
    },

    async remove(tx: Tx, ctx: RequestContext, id: string) {
      requirePermission(ctx, perm("write"));
      const r = await tx.update(t).set({ deletedAt: new Date() } as never).where(live(id)).returning({ id: t.id });
      if (!r.length) throw notFound(def.name);
      await audit(tx, ctx, `${def.name}.deleted`, { type: def.name, id });
      await emitEvent(tx, ctx, `core.${def.name}.deleted`, { id });
    },
  };
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest("Validation failed", z.flattenError(r.error));
  return r.data;
}
