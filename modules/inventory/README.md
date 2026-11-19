# Inventory & Purchasing (`inventory`)

Track stock for everything you buy, log every change with a reason, see what's running low, and turn it into purchase orders per supplier. Receiving an order adds what arrived to stock.

Turned off by default. An owner or admin adds it under **Add features**. Turning it off hides the pages and makes the API answer 403, but keeps all data; adding it again brings everything back.

## Who can do what

| Permission | Lets you | Default roles |
|---|---|---|
| `inventory:stock.read` | See items, stock history and purchase orders | viewer, member, manager, admin, owner |
| `inventory:stock.adjust` | Record deliveries, usage, waste and counts | member, manager, admin, owner |
| `inventory:purchasing.manage` | Add, edit and archive items; create, edit, send, receive and cancel purchase orders | manager, admin, owner |

Suppliers are the workspace's core **Companies**, read through `ctx.data.companies`, so the module declares `core:companies.read`. It also declares `core:members.read` to show who made each change.

## Pages

- **Inventory** (`/inventory`): every item with its stock, minimum, supplier, unit cost and stock value.
  - Items at or below their minimum are red, with a banner to show only those.
  - You can filter by search, category, supplier, low stock and archived items.
  - **Change stock** opens a dialog: pick a reason (Delivery, Usage, Waste or Count correction), enter the quantity, and see the stock after the change.
- **Item** (`/inventory/:id`): a stock card with quick reason buttons, open orders for the item, and its full history. Managers can edit, archive and restore items.
- **New / edit item**: name, category, SKU, unit, unit cost, starting stock, minimum, reorder amount, supplier and notes.
- **Stock history** (`/inventory/history`): every change across all items, filtered by reason, item and dates.
- **Purchase orders** (`/purchase-orders`): orders sorted into Open, Received, Cancelled and All.
  - **Order low stock** creates one draft order per supplier. It includes every low item that isn't already on an open order.
  - **New order** starts an empty order for a chosen supplier.
- **Order** (`/purchase-orders/:id`):
  - Change quantities and prices, add or remove items, and set the delivery date and notes.
  - **Mark as sent**, **Copy as text** (for an email to the supplier) and **Cancel**. Drafts can be deleted.
  - **Receive** asks how much of each line arrived, then updates stock.
- **Dashboard widget**: how many items are low (and how many are already on order), the lowest items, and open orders.

## Rules

- Stock never goes below 0. Taking more than there is gives a 409 error that says how much is left.
- Quantities can have up to 3 decimals (kg, litres). Prices are stored in whole cents.
- Delivery adds stock, usage and waste take it away, and count correction sets the number you counted.
- Every change is logged with its reason, note, person, time and stock after the change. A new item's starting stock is logged as "Starting stock".
- An item is **low** when its minimum is above 0 and its stock is at or below the minimum. Dropping to or below the minimum emits `inventory.stock.low` once.
- Generated order quantity: the item's **reorder amount** if set, otherwise enough to get back to twice the minimum.
- Generating orders skips items that have no supplier, are already on an open order, or whose supplier company was deleted. The result lists each skipped item and why.
- Order statuses: draft → sent → received. Draft or sent orders can also be cancelled.
  - Draft and sent orders can be edited. Only drafts can be deleted.
  - Received and cancelled orders are locked.
  - An item can't be on the same order twice.
- Receiving logs a delivery for each line with the order number, and makes the price paid the item's new unit cost.
- Items are never deleted, only archived, because history and orders point at them. An item on an open order can't be archived.
- Every table has `tenant_id` with row-level security. A company can only use its own suppliers.

## Events

`inventory.stock.changed`, `inventory.stock.low`, `inventory.order.created`, `inventory.order.sent`, `inventory.order.received`. All of them can trigger workflows, for example "when an item drops to its minimum, create a task".

## Tests

- `apps/api/test/inventory.test.ts`: roles, validation, stock changes, history, low-stock event, order generation, edit/send/receive, cancel/delete, archive, company isolation, turning it off and on.
- `apps/web/e2e/inventory.spec.ts`: the whole flow in a browser.
