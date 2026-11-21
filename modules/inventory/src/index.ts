import { metrics } from "./metrics.ts";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { defineModule, route } from "@office/sdk";
import {
  AdjustInput, adjust, archiveItem, cancelOrder, config, createItem, createOrder, deleteOrder, generateOrders, getItem, getOrder, ItemInput,
  ItemPatch, ItemQuery, listItems, listMovements, listOrders, MovementQuery, OrderInput, OrderPatch, OrderQuery, P, ReceiveInput, receiveOrder,
  sendOrder, summary, suppliers, updateItem, updateOrder,
} from "./service.ts";

const Id = z.object({ id: z.uuid() });
const EVENTS = ["inventory.stock.changed", "inventory.stock.low", "inventory.order.created", "inventory.order.sent", "inventory.order.received"];

export default defineModule({
  manifest: {
    key: "inventory",
    name: "Inventory & Purchasing",
    version: "1.0.0",
    office: "^1.0",
    description: "Track stock for everything you buy, log deliveries, usage, waste and counts, get low-stock alerts, and turn them into purchase orders per supplier. Receiving an order updates stock.",
    icon: "package",
    category: "operations",
    permissions: {
      declares: [
        { key: P.READ, label: "See items, stock history and purchase orders" },
        { key: P.ADJUST, label: "Record deliveries, usage, waste and stock counts" },
        { key: P.MANAGE, label: "Add and edit items, create, send and receive purchase orders" },
      ],
      requires: ["core:companies.read", "core:members.read"],
    },
    roles: { manager: [P.READ, P.ADJUST, P.MANAGE], member: [P.READ, P.ADJUST], viewer: [P.READ] },
    entities: ["item", "purchase_order"],
    events: { emits: EVENTS.map((type) => ({ type })), subscribes: [] },
    workflow: { triggers: EVENTS, actions: [] },
    ui: {
      slots: [
        { slot: "nav.main", label: "Inventory", icon: "package", route: "/inventory", permission: P.READ },
        { slot: "nav.main", label: "Purchase orders", icon: "cart", route: "/purchase-orders", permission: P.READ },
        { slot: "dashboard.widget", label: "Low stock", component: "LowStockWidget", permission: P.READ },
      ],
    },
    settings: {
      type: "object",
      properties: {
        currency: { type: "string", title: "Currency", description: "Three-letter code used for costs and purchase orders, e.g. EUR.", default: "EUR", pattern: "^[A-Z]{3}$" },
      },
      additionalProperties: false,
    },
    api: { basePath: "/inventory" },
  },
  migrationsDir: fileURLToPath(new URL("../migrations", import.meta.url)),
  metrics,
  routes: [
    route({ method: "GET", path: "/config", permission: P.READ, handler: (ctx) => config(ctx) }),
    route({ method: "GET", path: "/summary", permission: P.READ, handler: (ctx) => summary(ctx) }),
    route({ method: "GET", path: "/suppliers", permission: P.READ, handler: (ctx) => suppliers(ctx) }),

    route({ method: "GET", path: "/items", permission: P.READ, query: ItemQuery, handler: (ctx, { query }) => listItems(ctx, query) }),
    route({ method: "POST", path: "/items", permission: P.MANAGE, status: 201, body: ItemInput, handler: (ctx, { body }) => createItem(ctx, body) }),
    route({ method: "GET", path: "/items/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getItem(ctx, params.id) }),
    route({ method: "PATCH", path: "/items/:id", permission: P.MANAGE, params: Id, body: ItemPatch, handler: (ctx, { params, body }) => updateItem(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/items/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => archiveItem(ctx, params.id) }),
    route({ method: "POST", path: "/items/:id/adjust", permission: P.ADJUST, params: Id, body: AdjustInput, handler: (ctx, { params, body }) => adjust(ctx, params.id, body) }),
    route({ method: "GET", path: "/movements", permission: P.READ, query: MovementQuery, handler: (ctx, { query }) => listMovements(ctx, query) }),

    route({ method: "GET", path: "/orders", permission: P.READ, query: OrderQuery, handler: (ctx, { query }) => listOrders(ctx, query) }),
    route({ method: "POST", path: "/orders", permission: P.MANAGE, status: 201, body: OrderInput, handler: (ctx, { body }) => createOrder(ctx, body) }),
    route({ method: "POST", path: "/orders/generate", permission: P.MANAGE, handler: (ctx) => generateOrders(ctx) }),
    route({ method: "GET", path: "/orders/:id", permission: P.READ, params: Id, handler: (ctx, { params }) => getOrder(ctx, params.id) }),
    route({ method: "PATCH", path: "/orders/:id", permission: P.MANAGE, params: Id, body: OrderPatch, handler: (ctx, { params, body }) => updateOrder(ctx, params.id, body) }),
    route({ method: "DELETE", path: "/orders/:id", permission: P.MANAGE, params: Id, status: 204, handler: (ctx, { params }) => deleteOrder(ctx, params.id) }),
    route({ method: "POST", path: "/orders/:id/send", permission: P.MANAGE, params: Id, handler: (ctx, { params }) => sendOrder(ctx, params.id) }),
    route({ method: "POST", path: "/orders/:id/receive", permission: P.MANAGE, params: Id, body: ReceiveInput, handler: (ctx, { params, body }) => receiveOrder(ctx, params.id, body) }),
    route({ method: "POST", path: "/orders/:id/cancel", permission: P.MANAGE, params: Id, handler: (ctx, { params }) => cancelOrder(ctx, params.id) }),
  ],
});
