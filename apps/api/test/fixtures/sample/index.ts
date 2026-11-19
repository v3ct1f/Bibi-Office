import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";
import { uuidv7 } from "@office/db";
import { action, defineModule, route, sqlRows, type ModuleContext } from "@office/sdk";

const notes = pgTable("sample_notes", {
  id: uuid("id").primaryKey(), tenantId: uuid("tenant_id").notNull(), contactId: uuid("contact_id").notNull(),
  text: text("text").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

async function addNote(ctx: ModuleContext, contactId: string, text: string) {
  await ctx.data.contacts.get(contactId); // permission + existence check via core
  const id = uuidv7();
  await ctx.db.insert(notes).values({ id, tenantId: ctx.tenantId, contactId, text });
  await ctx.events.emit("sample.note.created", { id, contactId });
  return { noteId: id };
}

export default defineModule({
  manifest: {
    key: "sample", name: "Sample", version: "1.0.0", office: "^1.0",
    permissions: {
      declares: [{ key: "sample:notes.read", label: "Read notes" }, { key: "sample:notes.write", label: "Write notes" }],
      requires: ["core:contacts.read"],
    },
    events: { emits: [{ type: "sample.note.created" }], subscribes: ["core.contact.created"] },
    workflow: { triggers: ["sample.note.created"], actions: [{ key: "sample.add_note", label: "Add note" }] },
    ui: { slots: [{ slot: "entity.tab:contact", label: "Notes", component: "NotesTab" }] },
    settings: {
      type: "object",
      properties: { greeting: { type: "string", default: "Welcome", maxLength: 50 }, apiToken: { type: "string", "x-secret": true } },
      additionalProperties: false,
    },
  },
  migrationsDir: fileURLToPath(new URL("./migrations", import.meta.url)),
  routes: [
    route({
      method: "GET", path: "/notes", permission: "sample:notes.read",
      query: z.object({ contactId: z.uuid() }),
      handler: async (ctx, { query }) => ({
        data: await ctx.db.select().from(notes).where(eq(notes.contactId, query.contactId)),
        tokenConfigured: !!ctx.secrets.get("apiToken"),
      }),
    }),
    route({
      method: "POST", path: "/notes", permission: "sample:notes.write", status: 201,
      body: z.object({ contactId: z.uuid(), text: z.string().min(1).max(1000) }),
      handler: (ctx, { body }) => addNote(ctx, body.contactId, body.text),
    }),
    route({
      method: "POST", path: "/misbehave", permission: "sample:notes.write",
      body: z.object({ what: z.enum(["emit", "write", "sql_core_read", "sql_core_write"]) }),
      handler: async (ctx, { body }) => {
        if (body.what === "emit") await ctx.events.emit("crm.deal.won", {});
        else if (body.what === "write") await ctx.data.contacts.create({ firstName: "x" });
        else if (body.what === "sql_core_read") await ctx.db.execute(sql`select count(*) from contacts`);
        else await ctx.db.execute(sql`update tenants set name = 'pwned'`);
      },
    }),
    route({
      method: "GET", path: "/whoami", permission: "sample:notes.read",
      handler: async (ctx) => {
        const one = async () => sqlRows<{ u: string }>(await ctx.db.execute(sql`select current_user as u`))[0]!.u;
        const before = await one();
        // A core call overlapping module queries: core runs as the app role, the module role comes back after.
        const [inside, list] = await Promise.all([one(), ctx.data.contacts.list({ limit: 1 })]);
        const after = await one();
        return { before, inside, after, contacts: list.data.length, today: await ctx.clock.today(), timeZone: await ctx.clock.timeZone() };
      },
    }),
  ],
  handlers: {
    "core.contact.created": async (ctx, e) => {
      const { greeting } = ctx.settings.get<{ greeting: string }>();
      await addNote(ctx, String(e.payload.id), `${greeting}, ${String(e.payload.firstName ?? "")}`.trim());
    },
  },
  actions: {
    "sample.add_note": action({
      label: "Add note", input: z.object({ contactId: z.uuid(), text: z.string().min(1) }),
      run: (ctx, i) => addNote(ctx, i.contactId, i.text),
    }),
  },
});
