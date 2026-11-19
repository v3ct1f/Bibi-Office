-- Inventory & purchasing v1: items with stock levels, a log of every stock change, and purchase orders per supplier.
-- Suppliers are core companies (referenced by id; names are read through the SDK). Quantities allow 3 decimals (kg, litres).

CREATE TABLE inventory_items (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  sku              text CHECK (sku IS NULL OR length(sku) <= 60),
  category         text CHECK (category IS NULL OR length(category) <= 60),
  unit             text NOT NULL DEFAULT 'unit' CHECK (length(unit) BETWEEN 1 AND 20),
  stock            numeric(14,3) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock        numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  reorder_qty      numeric(14,3) CHECK (reorder_qty IS NULL OR reorder_qty > 0),
  supplier_id      uuid,
  unit_cost_cents  integer NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  notes            text,
  archived         boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX inventory_items_name_idx ON inventory_items (tenant_id, lower(name)) WHERE NOT archived;
CREATE UNIQUE INDEX inventory_items_sku_idx ON inventory_items (tenant_id, lower(sku)) WHERE sku IS NOT NULL AND NOT archived;
CREATE INDEX inventory_items_supplier_idx ON inventory_items (tenant_id, supplier_id);

CREATE TABLE inventory_orders (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq           integer NOT NULL CHECK (seq > 0),
  supplier_id   uuid NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','received','cancelled')),
  currency      text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  notes         text,
  expected_on   date,
  created_by    uuid,
  sent_at       timestamptz,
  received_at   timestamptz,
  received_by   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, seq)
);
CREATE INDEX inventory_orders_status_idx ON inventory_orders (tenant_id, status, created_at DESC);

CREATE TABLE inventory_order_lines (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL,
  item_id           uuid NOT NULL,
  position          integer NOT NULL,
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost_cents   integer NOT NULL CHECK (unit_cost_cents >= 0),
  received_qty      numeric(14,3) CHECK (received_qty IS NULL OR received_qty >= 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES inventory_orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id)
);
CREATE INDEX inventory_order_lines_order_idx ON inventory_order_lines (tenant_id, order_id, position);
CREATE INDEX inventory_order_lines_item_idx ON inventory_order_lines (tenant_id, item_id);

-- Every stock change, newest last. stock_after makes the history readable without replaying it.
CREATE TABLE inventory_movements (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL,
  reason       text NOT NULL CHECK (reason IN ('delivery','usage','waste','count')),
  delta        numeric(14,3) NOT NULL,
  stock_after  numeric(14,3) NOT NULL CHECK (stock_after >= 0),
  note         text,
  order_id     uuid,
  actor_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES inventory_orders(tenant_id, id) ON DELETE SET NULL (order_id)
);
CREATE INDEX inventory_movements_item_idx ON inventory_movements (tenant_id, item_id, created_at DESC);
CREATE INDEX inventory_movements_time_idx ON inventory_movements (tenant_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items','inventory_orders','inventory_order_lines','inventory_movements'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_items, inventory_orders, inventory_order_lines, inventory_movements TO office_app;
