-- Leads v1: people who might become customers, before they are contacts / deals.
-- A lead moves new -> contacted -> qualified -> converted (or disqualified at any point; it can be reopened).
-- Converting creates or reuses a core contact (and company) and remembers them here.

CREATE TABLE leads_leads (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name         text,
  last_name          text,
  email              text,
  phone              text,
  company_name       text,
  job_title          text,
  source             text NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual', 'web_form', 'referral', 'event', 'phone', 'email', 'social', 'ads', 'workflow', 'other')),
  status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'disqualified', 'converted')),
  owner_id           uuid,
  value_cents        bigint NOT NULL DEFAULT 0 CHECK (value_cents >= 0),
  currency           char(3) NOT NULL,
  follow_up_on       date,
  message            text,
  notes              text,
  disqualify_reason  text,
  contact_id         uuid,
  company_id         uuid,
  converted_at       timestamptz,
  status_changed_at  timestamptz NOT NULL DEFAULT now(),
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  -- Someone to reach: a name, an email, a phone number or a company.
  CHECK (coalesce(first_name, last_name, email, phone, company_name) IS NOT NULL),
  CHECK ((status = 'converted') = (converted_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies(tenant_id, id) ON DELETE SET NULL (company_id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX leads_leads_status_idx ON leads_leads (tenant_id, status, id DESC);
CREATE INDEX leads_leads_email_idx ON leads_leads (tenant_id, lower(email));

CREATE TABLE leads_activities (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id     uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('note', 'call', 'meeting', 'email', 'status', 'system')),
  body        text NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads_leads(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX leads_activities_lead_idx ON leads_activities (tenant_id, lead_id, created_at DESC);

-- The business's public "contact us" form. The token in its link is the only key; replacing it breaks old links.
CREATE TABLE leads_forms (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  enabled     boolean NOT NULL DEFAULT true,
  heading     text NOT NULL,
  intro       text,
  thanks      text NOT NULL,
  ask_phone   boolean NOT NULL DEFAULT true,
  ask_company boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leads_leads','leads_activities','leads_forms'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON leads_leads, leads_activities, leads_forms TO office_app;
