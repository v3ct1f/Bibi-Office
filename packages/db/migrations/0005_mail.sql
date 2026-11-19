-- Core email: queued outbound mail (sent by the worker with retries) and inbound routing.

CREATE TABLE mail_outbox (
  id              uuid PRIMARY KEY,
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module          text,                                   -- sender module (null = core)
  to_addrs        text[] NOT NULL CHECK (cardinality(to_addrs) BETWEEN 1 AND 20),
  subject         text NOT NULL CHECK (length(subject) <= 500),
  text_body       text NOT NULL CHECK (length(text_body) <= 200000),
  html_body       text CHECK (length(html_body) <= 500000),
  from_name       text CHECK (length(from_name) <= 120),
  reply_to        text CHECK (length(reply_to) <= 320),
  message_id      text NOT NULL,                          -- RFC 5322 Message-ID we set (without <>)
  in_reply_to     text,
  "references"    text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id)
);
CREATE INDEX mail_outbox_due ON mail_outbox (next_attempt_at) WHERE status = 'queued';

-- Inbound address local parts: <key>@<INBOUND_MAIL_DOMAIN> -> (tenant, module). Keys are random.
CREATE TABLE mail_routes (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z0-9]{12,40}$'),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, module)
);

-- Dedupe of inbound messages (providers retry).
CREATE TABLE mail_inbound (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module       text NOT NULL,
  message_id   text NOT NULL,
  from_email   text NOT NULL,
  subject      text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, message_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mail_outbox', 'mail_routes', 'mail_inbound'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON mail_outbox, mail_inbound TO office_app;
GRANT SELECT, INSERT ON mail_routes TO office_app;

-- The definer (migration owner) is itself subject to FORCE RLS: let it read routes for the lookup below.
CREATE POLICY route_lookup ON mail_routes FOR SELECT TO CURRENT_USER USING (true);

-- The inbound webhook knows only the address; resolve it before a tenant is chosen.
CREATE FUNCTION mail_route_lookup(k text) RETURNS TABLE (tenant_id uuid, module text)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT r.tenant_id, r.module FROM mail_routes r JOIN tenants t ON t.id = r.tenant_id WHERE r.key = k AND t.status = 'active' $$;
REVOKE ALL ON FUNCTION mail_route_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mail_route_lookup(text) TO office_app;

GRANT SELECT, UPDATE (status, attempts, next_attempt_at, last_error, sent_at) ON mail_outbox TO office_relay;
