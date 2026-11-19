import { fileURLToPath } from "node:url";
import { z } from "zod";
import { action, defineModule, file, route } from "@office/sdk";
import {
  CountIn, createItem, createLocation, defaultLocation, getItem, ItemIn, ItemPatch, ItemQuery, itemBySku, listItems, listLocations, listMovements,
  LocationIn, LocationPatch, move, MoveIn, MovementQuery, P, recordCount, reorderList, seedLocation, SETTINGS_SCHEMA, stockCsv, summary,
  updateItem, updateLocation,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const EVENTS = [
  "inventory.item.created", "inventory.stock.received", "inventory.stock.issued", "inventory.stock.transferred", "inventory.stock.adjusted", "inventory.stock.low",
];

export default defineModule({
  manifest: {
    key: "inventory",
    name: "Inventory",
    version: "1.0.0",
    office: "^1.0",
    description: "Items, stock by location, an append-only movement ledger, stock counts, reorder points and stock value.",
    permissions: {
      declares: [
        { key: P.read, label: "See items, stock levels and movements", defaultRoles: ["member"] },
        { key: P.move, label: "Receive, issue and transfer stock", defaultRoles: ["member"] },
        { key: P.adjust, label: "Adjust stock and record stock counts" },
        { key: P.manage, label: "Manage items and locations" },
      ],
      requires: [],
    },
    entities: ["item", "location"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: {
      triggers: EVENTS,
      actions: [{ key: "inventory.issue", label: "Issue stock" }, { key: "inventory.receive", label: "Receive stock" }],
    },
    ui: {
      slots: [
        { slot: "nav.main", label: "Inventory", icon: "package", route: "/inventory", permission: P.read },
        { slot: "dashboard.widget", label: "Low stock", component: "LowStockWidget", permission: P.read },
      ],
    },
    settings: SETTINGS_SCHEMA as unknown as Record<string, unknown>,
    api: { basePath: "/inventory" },
    lifecycle: ["enable"],
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  lifecycle: { enable: (ctx) => seedLocation(ctx) },
  routes: [
    route({ method: "GET", path: "/summary", permission: P.read, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/items", permission: P.read, query: ItemQuery, handler: (ctx, { query }) => listItems(ctx, query) }),
    route({ method: "POST", path: "/items", permission: P.manage, body: ItemIn, status: 201, handler: (ctx, { body }) => createItem(ctx, body) }),
    route({ method: "GET", path: "/items/:id", permission: P.read, params: Id, handler: (ctx, { params }) => getItem(ctx, params.id) }),
    route({ method: "PATCH", path: "/items/:id", permission: P.manage, params: Id, body: ItemPatch, handler: (ctx, { params, body }) => updateItem(ctx, params.id, body) }),
    route({ method: "GET", path: "/locations", permission: P.read, handler: (ctx) => listLocations(ctx) }),
    route({ method: "POST", path: "/locations", permission: P.manage, body: LocationIn, status: 201, handler: (ctx, { body }) => createLocation(ctx, body) }),
    route({ method: "PATCH", path: "/locations/:id", permission: P.manage, params: Id, body: LocationPatch, handler: (ctx, { params, body }) => updateLocation(ctx, params.id, body) }),
    // adjust is checked inside (needs inventory:stock.adjust)
    route({ method: "POST", path: "/movements", permission: P.move, body: MoveIn, status: 201, handler: (ctx, { body }) => move(ctx, body) }),
    route({ method: "GET", path: "/movements", permission: P.read, query: MovementQuery, handler: (ctx, { query }) => listMovements(ctx, query) }),
    route({ method: "POST", path: "/counts", permission: P.adjust, body: CountIn, status: 201, handler: (ctx, { body }) => recordCount(ctx, body) }),
    route({ method: "GET", path: "/reorder", permission: P.read, handler: (ctx) => reorderList(ctx) }),
    route({ method: "GET", path: "/export.csv", permission: P.read,
      handler: async (ctx) => file({ contentType: "text/csv; charset=utf-8", filename: "stock.csv", body: await stockCsv(ctx) }) }),
  ],
  actions: {
    "inventory.issue": action({
      label: "Issue stock",
      input: z.object({
        sku: z.string().min(1).max(64).describe("item SKU"), quantity: z.coerce.number().positive().max(1e10),
        locationId: z.uuid().optional().describe("defaults to the first location"), reference: z.string().max(120).optional(),
      }),
      run: async (ctx, i) => {
        const item = await itemBySku(ctx, i.sku);
        const locationId = i.locationId ?? (await defaultLocation(ctx)).id;
        const r = await move(ctx, { type: "issue", itemId: item.id, locationId, quantity: i.quantity, reference: i.reference ?? null, note: null });
        return { itemId: r.id, sku: r.sku, onHand: r.onHand, low: r.low };
      },
    }),
    "inventory.receive": action({
      label: "Receive stock",
      input: z.object({
        sku: z.string().min(1).max(64), quantity: z.coerce.number().positive().max(1e10),
        locationId: z.uuid().optional(), reference: z.string().max(120).optional(), unitCost: z.coerce.number().int().min(0).optional(),
      }),
      run: async (ctx, i) => {
        const item = await itemBySku(ctx, i.sku);
        const locationId = i.locationId ?? (await defaultLocation(ctx)).id;
        const r = await move(ctx, { type: "receive", itemId: item.id, locationId, quantity: i.quantity, reference: i.reference ?? null, note: null, ...(i.unitCost !== undefined ? { unitCost: i.unitCost } : {}) });
        return { itemId: r.id, sku: r.sku, onHand: r.onHand };
      },
    }),
  },
});
