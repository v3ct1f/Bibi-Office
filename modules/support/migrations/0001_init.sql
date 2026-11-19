-- Support inbox v1: tickets from email, a public contact form, or the team; threaded messages; first-response SLA.

CREATE TABLE support_counters (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_no    integer NOT NULL DEFAULT 0
);

CREATE TABLE support_tickets (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number             integer NOT NULL CHECK (number > 0),
  subject            text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  status             text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'open', 'pending', 'solved')),
  priority           text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  channel            text NOT NULL CHECK (channel IN ('email', 'web', 'internal')),
  requester_name     text CHECK (length(requester_name) <= 200),
  requester_email    text NOT NULL CHECK (length(requester_email) BETWEEN 3 AND 320),
  contact_id         uuid,
  assignee_id        uuid,
  due_at             timestamptz,                       -- first-response target
  first_response_at  timestamptz,
  sla_breached_at    timestamptz,
  solved_at          timestamptz,
  last_message_at    timestamptz NOT NULL DEFAULT now(),
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  CHECK ((status = 'solved') = (solved_at IS NOT NULL)),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE SET NULL (contact_id),
  FOREIGN KEY (tenant_id, assignee_id) REFERENCES memberships(tenant_id, user_id) ON DELETE SET NULL (assignee_id)
);
CREATE INDEX support_tickets_queue ON support_tickets (tenant_id, status, last_message_at DESC);
CREATE INDEX support_tickets_assignee ON support_tickets (tenant_id, assignee_id, status);
CREATE INDEX support_tickets_requester ON support_tickets (tenant_id, requester_email);
CREATE INDEX support_tickets_contact ON support_tickets (tenant_id, contact_id);
CREATE INDEX support_tickets_sla ON support_tickets (tenant_id, due_at) WHERE first_response_at IS NULL AND sla_breached_at IS NULL AND status <> 'solved';

CREATE TABLE support_messages (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id    uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('customer', 'reply', 'note')),
  author_id    uuid,                                     -- team member for reply/note
  from_email   text CHECK (length(from_email) <= 320),
  from_name    text CHECK (length(from_name) <= 200),
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  message_id   text CHECK (length(message_id) <= 998),   -- email Message-ID (without <>) for threading
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES support_tickets(tenant_id, id) ON DELETE CASCADE,
  CHECK (kind = 'customer' OR author_id IS NOT NULL)
);
CREATE INDEX support_messages_ticket ON support_messages (tenant_id, ticket_id, created_at);
CREATE UNIQUE INDEX support_messages_msgid ON support_messages (tenant_id, message_id) WHERE message_id IS NOT NULL;

-- Messages are an append-only record: no edits, no deletes (except with the ticket's tenant).
CREATE FUNCTION support_messages_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'support messages cannot be changed' USING ERRCODE = 'check_violation'; END $$;
CREATE TRIGGER support_messages_no_update BEFORE UPDATE ON support_messages FOR EACH ROW EXECUTE FUNCTION support_messages_immutable();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['support_counters', 'support_tickets', 'support_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON support_counters, support_tickets TO office_app;
GRANT SELECT, INSERT ON support_messages TO office_app;
