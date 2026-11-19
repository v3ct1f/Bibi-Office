-- KPI dashboards: a shared, ordered set of tiles per tenant. Values are computed live from module metrics (no copies of data here).
CREATE TABLE kpi_dashboards (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  position    integer NOT NULL DEFAULT 0,
  tiles       jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tiles) = 'array' AND jsonb_array_length(tiles) <= 24),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX kpi_dashboards_order ON kpi_dashboards (tenant_id, position, created_at);

ALTER TABLE kpi_dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_dashboards FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kpi_dashboards USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON kpi_dashboards TO office_app;
