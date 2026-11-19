-- Inventory v1: items, locations, an append-only stock ledger, and on-hand quantities kept by trigger.
-- Quantities numeric(14,3); money bigint minor units in the module currency.

CREATE TABLE inventory_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku            text NOT NULL CHECK (sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$'),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description    text CHECK (length(description) <= 2000),
  category       text CHECK (length(category) <= 80),
  unit           text NOT NULL DEFAULT 'pcs' CHECK (length(unit) BETWEEN 1 AND 20),
  barcode        text CHECK (length(barcode) <= 64),
  cost           bigint NOT NULL DEFAULT 0 CHECK (cost >= 0 AND cost <= 1000000000000),
  price          bigint CHECK (price >= 0 AND price <= 1000000000000),
  reorder_point  numeric(14,3) CHECK (reorder_point >= 0),
  reorder_qty    numeric(14,3) CHECK (reorder_qty > 0),
  archived       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX inventory_items_sku ON inventory_items (tenant_id, lower(sku));
CREATE UNIQUE INDEX inventory_items_barcode ON inventory_items (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX inventory_items_name ON inventory_items (tenant_id, lower(name));

CREATE TABLE inventory_locations (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  archived    boolean NOT NULL DEFAULT false,
  position    int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX inventory_locations_name ON inventory_locations (tenant_id, lower(name));

-- The ledger. Never updated or deleted; corrections are new movements.
CREATE TABLE inventory_movements (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL,
  location_id  uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('receipt', 'issue', 'adjustment', 'transfer_out', 'transfer_in', 'count')),
  quantity     numeric(14,3) NOT NULL CHECK (quantity <> 0),          -- signed: + in, - out
  unit_cost    bigint CHECK (unit_cost >= 0),
  group_id     uuid NOT NULL,                                          -- links a transfer pair or one stock count
  reference    text CHECK (length(reference) <= 120),
  note         text CHECK (length(note) <= 1000),
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES inventory_locations(tenant_id, id),
  CHECK (kind NOT IN ('receipt', 'transfer_in') OR quantity > 0),
  CHECK (kind NOT IN ('issue', 'transfer_out') OR quantity < 0)
);
CREATE INDEX inventory_movements_item ON inventory_movements (tenant_id, item_id, created_at DESC);
CREATE INDEX inventory_movements_recent ON inventory_movements (tenant_id, created_at DESC, id DESC);

-- On hand per item and location; only the trigger writes it. Never below zero.
CREATE TABLE inventory_stock (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL,
  location_id  uuid NOT NULL,
  quantity     numeric(14,3) NOT NULL DEFAULT 0 CONSTRAINT inventory_stock_not_negative CHECK (quantity >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id, location_id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory_items(tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES inventory_locations(tenant_id, id)
);

-- SECURITY DEFINER so the app role can read stock but never write it; RLS still applies (tenant GUC).
CREATE FUNCTION inventory_apply_movement() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- update first: an INSERT of a negative row would trip the CHECK before ON CONFLICT is considered
  UPDATE inventory_stock SET quantity = quantity + NEW.quantity, updated_at = now()
   WHERE tenant_id = NEW.tenant_id AND item_id = NEW.item_id AND location_id = NEW.location_id;
  IF NOT FOUND THEN
    INSERT INTO inventory_stock (tenant_id, item_id, location_id, quantity, updated_at)
    VALUES (NEW.tenant_id, NEW.item_id, NEW.location_id, NEW.quantity, now())
    ON CONFLICT (tenant_id, item_id, location_id)
    DO UPDATE SET quantity = inventory_stock.quantity + EXCLUDED.quantity, updated_at = now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_apply_movement_ai AFTER INSERT ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_apply_movement();

CREATE FUNCTION inventory_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'stock movements cannot be changed; record a correction' USING ERRCODE = 'check_violation'; END $$;
CREATE TRIGGER inventory_ledger_immutable_bud BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_ledger_immutable();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items', 'inventory_locations', 'inventory_movements', 'inventory_stock'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON inventory_items, inventory_locations TO office_app;
GRANT SELECT, INSERT ON inventory_movements TO office_app;
GRANT SELECT ON inventory_stock TO office_app;
