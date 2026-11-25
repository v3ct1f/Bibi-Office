-- Work email v1: a company domain (bought through us, or connected from elsewhere) and work mailboxes on it.
-- The business is the registrant of a domain we buy for it, so it can take the domain away (transfer code).

CREATE TABLE workmail_domains (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (name = lower(name)),
  source        text NOT NULL CHECK (source IN ('bought', 'connected')),
  -- bought: awaiting_payment -> active.  connected: dns_pending -> active.  removed: kept for history.
  status        text NOT NULL CHECK (status IN ('awaiting_payment', 'dns_pending', 'active', 'removed')),
  provider_ref  text,
  price_cents   integer CHECK (price_cents IS NULL OR price_cents >= 0),
  currency      char(3),
  payment_ref   text,
  last_error    text,
  -- Who the domain is registered to (the business). Only for bought domains.
  registrant    jsonb,
  registered_at timestamptz,
  expires_on    date,
  dns_checked_at timestamptz,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
-- One live owner per domain name, across all businesses.
CREATE UNIQUE INDEX workmail_domains_name_uq ON workmail_domains (name) WHERE status <> 'removed';

CREATE TABLE workmail_mailboxes (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain_id      uuid NOT NULL,
  local_part     text NOT NULL CHECK (local_part = lower(local_part)),
  display_name   text NOT NULL,
  -- The colleague this mailbox belongs to (a member's user id), if any.
  user_id        uuid,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  -- Why it was switched off: colleague_removed, feature_off or by_hand.
  suspend_reason text CHECK (suspend_reason IS NULL OR suspend_reason IN ('colleague_removed', 'feature_off', 'by_hand')),
  provider_ref   text,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, domain_id) REFERENCES workmail_domains(tenant_id, id)
);
CREATE UNIQUE INDEX workmail_mailboxes_addr_uq ON workmail_mailboxes (tenant_id, domain_id, local_part) WHERE status <> 'deleted';
CREATE INDEX workmail_mailboxes_user_idx ON workmail_mailboxes (tenant_id, user_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['workmail_domains','workmail_mailboxes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON workmail_domains, workmail_mailboxes TO office_app;
