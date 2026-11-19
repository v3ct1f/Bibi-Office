# Inventory (`inventory`)

Items, stock by location, an append-only movement ledger, stock counts, reorder points and stock value.

## Model
- `inventory_items`: SKU (unique per tenant, case-insensitive), name, category, unit, barcode (unique), `cost` (minor units, moving average), `price`, `reorder_point`, `reorder_qty`, archived. Quantities are `numeric(14,3)`.
- `inventory_locations`: name (unique), position, archived. "Main" is seeded on enable.
- `inventory_movements`: the ledger. `kind` = `receipt | issue | adjustment | transfer_out | transfer_in | count`, signed `quantity` (sign checked per kind), `unit_cost`, `group_id` (a transfer's two rows, or one count), reference, note, `created_by`. **Append-only**: UPDATE/DELETE raise.
- `inventory_stock`: on hand per (item, location). Maintained only by the `AFTER INSERT` trigger on movements (`SECURITY DEFINER`); the app role has SELECT only. `CHECK (quantity >= 0)`: stock can never go negative, also under concurrency.

## Rules
- Receive / issue / transfer need `inventory:stock.move`; adjust (with a reason) and counts need `inventory:stock.adjust`.
- Moves lock the item row (`FOR UPDATE`) so concurrent issues serialize; overselling returns 409 "Not enough … in stock at that location".
- A receipt with `unitCost` updates the item's moving average cost.
- Count: per location, only the differences are posted as `count` movements.
- `inventory.stock.low` fires once when the total on hand crosses down to the reorder point.
- Items and locations can't be archived while they hold stock. Archived items can't be moved.
- CSV export neutralizes spreadsheet formulas.

## Permissions
| Key | Default roles |
|---|---|
| `inventory:items.read` | member, admin |
| `inventory:stock.move` | member, admin |
| `inventory:stock.adjust` | admin |
| `inventory:items.manage` | admin |

## Events / workflow
`inventory.item.created`, `inventory.stock.received`, `.issued`, `.transferred`, `.adjusted`, `.low` (all triggers). Actions `inventory.issue {sku, quantity, locationId?, reference?}`, `inventory.receive {sku, quantity, locationId?, reference?, unitCost?}`.

## API (`/api/v1/m/inventory`)
`GET /summary`, `GET|POST /items` (`q` incl. exact barcode, `category`, `locationId`, `low`, `archived`, cursor), `GET|PATCH /items/:id`, `GET|POST /locations`, `PATCH /locations/:id`, `POST /movements {type: receive|issue|transfer|adjust, …}`, `GET /movements` (`itemId`, `locationId`, `kind`, cursor), `POST /counts {locationId, lines[{itemId, counted}]}`, `GET /reorder`, `GET /export.csv`.

## UI
Nav "Inventory" (`/m/inventory/inventory`): Items, Movements, Reorder, Locations; stock count sheet; item page with Receive, Issue, Move, Adjust and history. Dashboard widget "Low stock".

## Settings
`currency` (EUR).
