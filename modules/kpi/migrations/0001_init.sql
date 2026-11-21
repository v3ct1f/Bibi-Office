-- KPI dashboard: shared boards of tiles, targets, numbers typed in by hand, and a weekly email digest.
CREATE TABLE kpi_boards (
  id                   uuid PRIMARY KEY,
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                 text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description          text CHECK (length(description) <= 300),
  position             integer NOT NULL DEFAULT 0,
  period               text NOT NULL DEFAULT 'month' CHECK (period IN ('week','month','quarter','year')),
  compare              text NOT NULL DEFAULT 'previous' CHECK (compare IN ('previous','last_year','none')),
  digest_enabled       boolean NOT NULL DEFAULT false,
  digest_weekday       smallint NOT NULL DEFAULT 1 CHECK (digest_weekday BETWEEN 1 AND 7),
  digest_hour          smallint NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
  digest_recipients    jsonb NOT NULL DEFAULT '[]',
  digest_last_sent_at  timestamptz,
  digest_last_error    text,
  app_url              text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kpi_boards_position_idx ON kpi_boards (tenant_id, position);

CREATE TABLE kpi_tiles (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  board_id    uuid NOT NULL REFERENCES kpi_boards(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  metric_key  text NOT NULL CHECK (length(metric_key) <= 120),
  label       text CHECK (length(label) <= 80),
  chart       text NOT NULL DEFAULT 'bar' CHECK (chart IN ('bar','line','none'))
);
CREATE INDEX kpi_tiles_board_idx ON kpi_tiles (board_id, position);

-- One goal per metric and period length, the same for every board.
CREATE TABLE kpi_targets (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_key  text NOT NULL CHECK (length(metric_key) <= 120),
  period      text NOT NULL CHECK (period IN ('week','month','quarter','year')),
  value       numeric(18,2) NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, metric_key, period)
);

CREATE TABLE kpi_manual_metrics (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (length(description) <= 300),
  unit        text NOT NULL CHECK (unit IN ('count','money','hours','minutes','days','percent')),
  currency    text CHECK (currency ~ '^[A-Z]{3}$'),
  kind        text NOT NULL CHECK (kind IN ('total','snapshot')),
  better      text NOT NULL CHECK (better IN ('up','down')),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kpi_manual_values (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  metric_id   uuid NOT NULL REFERENCES kpi_manual_metrics(id) ON DELETE CASCADE,
  on_date     date NOT NULL,
  value       numeric(18,2) NOT NULL,
  note        text CHECK (length(note) <= 200),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metric_id, on_date)
);
CREATE INDEX kpi_manual_values_idx ON kpi_manual_values (tenant_id, metric_id, on_date);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['kpi_boards','kpi_tiles','kpi_targets','kpi_manual_metrics','kpi_manual_values'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON kpi_boards, kpi_tiles, kpi_targets, kpi_manual_metrics, kpi_manual_values TO office_app;
