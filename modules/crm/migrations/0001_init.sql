-- CRM v1: pipelines with ordered stages, deals, and a per-deal activity timeline.
-- Money is integer minor units (cents). A deal's status follows the kind of its stage (open | won | lost).

CREATE TABLE crm_pipelines (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE crm_stages (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id  uuid NOT NULL,
  name         text NOT NULL,
  position     integer NOT NULL,
  probability  integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  kind         text NOT NULL DEFAULT 'open' CHECK (kind IN ('open', 'won', 'lost')),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, pipeline_id, id),
  FOREIGN KEY (tenant_id, pipeline_id) REFERENCES crm_pipelines(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_stages_pipeline_idx ON crm_stages (tenant_id, pipeline_id, position);

CREATE TABLE crm_deals (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id       uuid NOT NULL,
  stage_id          uuid NOT NULL,
  title             text NOT NULL,
  value_cents       bigint NOT NULL DEFAULT 0 CHECK (value_cents >= 0),
  currency          char(3) NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  company_id        uuid,
  contact_id        uuid,
  owner_id          uuid,
  expected_close    date,
  next_step         text,
  next_step_date    date,
  notes             text,
  lost_reason       text,
  closed_at         timestamptz,
  stage_changed_at  timestamptz NOT NULL DEFAULT now(),
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  -- The stage must belong to the deal's pipeline; stages with deals cannot be deleted.
  FOREIGN KEY (tenant_id, pipeline_id, stage_id) REFERENCES crm_stages(tenant_id, pipeline_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE SET NULL (company_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX crm_deals_board_idx ON crm_deals (tenant_id, pipeline_id, stage_id);
CREATE INDEX crm_deals_company_idx ON crm_deals (tenant_id, company_id);
CREATE INDEX crm_deals_contact_idx ON crm_deals (tenant_id, contact_id);

CREATE TABLE crm_activities (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id     uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('note', 'call', 'meeting', 'email', 'stage', 'system')),
  body        text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES crm_deals(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_activities_deal_idx ON crm_activities (tenant_id, deal_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['crm_pipelines','crm_stages','crm_deals','crm_activities'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm_pipelines, crm_stages, crm_deals, crm_activities TO office_app;
