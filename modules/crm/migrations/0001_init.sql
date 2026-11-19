-- CRM v1: one pipeline per tenant (ordered stages), deals, activities.
-- Money = bigint minor units.

CREATE TABLE crm_stages (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  position    int NOT NULL CHECK (position >= 0),
  probability int NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX crm_stages_order ON crm_stages (tenant_id, position);

CREATE TABLE crm_deals (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  value            bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  currency         char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  stage_id         uuid NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  contact_id       uuid,
  company_id       uuid,
  owner_id         uuid,                            -- a member (user id) of this tenant
  expected_close   date,
  notes            text CHECK (length(notes) <= 4000),
  lost_reason      text CHECK (length(lost_reason) <= 500),
  closed_at        timestamptz,
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, stage_id) REFERENCES crm_stages(tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id),
  FOREIGN KEY (tenant_id, owner_id) REFERENCES memberships(tenant_id, user_id) ON DELETE SET NULL (owner_id),
  CHECK ((status = 'open') = (closed_at IS NULL))
);
CREATE INDEX crm_deals_list ON crm_deals (tenant_id, id DESC);
CREATE INDEX crm_deals_board ON crm_deals (tenant_id, stage_id) WHERE status = 'open';
CREATE INDEX crm_deals_contact ON crm_deals (tenant_id, contact_id);
CREATE INDEX crm_deals_company ON crm_deals (tenant_id, company_id);

CREATE TABLE crm_activities (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('note', 'call', 'email', 'meeting', 'task')),
  subject     text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  body        text CHECK (length(body) <= 10000),
  deal_id     uuid,
  contact_id  uuid,
  company_id  uuid,
  due_at      timestamptz,
  done_at     timestamptz,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, deal_id) REFERENCES crm_deals(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id),
  CHECK (deal_id IS NOT NULL OR contact_id IS NOT NULL OR company_id IS NOT NULL)
);
CREATE INDEX crm_activities_deal ON crm_activities (tenant_id, deal_id, created_at DESC);
CREATE INDEX crm_activities_contact ON crm_activities (tenant_id, contact_id, created_at DESC);
CREATE INDEX crm_activities_company ON crm_activities (tenant_id, company_id, created_at DESC);
CREATE INDEX crm_activities_open ON crm_activities (tenant_id, due_at) WHERE done_at IS NULL AND due_at IS NOT NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['crm_stages', 'crm_deals', 'crm_activities'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO office_app', t);
  END LOOP;
END $$;
