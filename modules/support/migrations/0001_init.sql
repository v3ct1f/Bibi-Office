-- Support inbox v1: tickets fed by a real mailbox (IMAP in, SMTP out), threaded messages with attachments,
-- internal notes, saved replies and response-time targets per priority.

CREATE TABLE support_tickets (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seq                 integer NOT NULL CHECK (seq > 0),
  subject             text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','solved')),
  priority            text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  channel             text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','manual')),
  requester_email     text CHECK (requester_email IS NULL OR length(requester_email) <= 320),
  requester_name      text CHECK (requester_name IS NULL OR length(requester_name) <= 200),
  contact_id          uuid,
  assignee_id         uuid,
  first_response_at   timestamptz,
  first_response_due  timestamptz,
  resolution_due      timestamptz,
  solved_at           timestamptz,
  last_message_at     timestamptz NOT NULL DEFAULT now(),
  last_inbound_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, seq)
);
CREATE INDEX support_tickets_status_idx ON support_tickets (tenant_id, status, last_message_at DESC);
CREATE INDEX support_tickets_assignee_idx ON support_tickets (tenant_id, assignee_id, status);
CREATE INDEX support_tickets_requester_idx ON support_tickets (tenant_id, lower(requester_email));
CREATE INDEX support_tickets_contact_idx ON support_tickets (tenant_id, contact_id);

-- kind: inbound (customer email), reply (agent email or logged answer), note (internal, never sent).
-- send_status only for replies that go out by email.
CREATE TABLE support_messages (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id     uuid NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('inbound','reply','note')),
  author_id     uuid,
  from_email    text,
  from_name     text,
  to_emails     text[] NOT NULL DEFAULT '{}',
  cc_emails     text[] NOT NULL DEFAULT '{}',
  subject       text,
  body          text NOT NULL CHECK (length(body) <= 200000),
  message_id    text CHECK (message_id IS NULL OR length(message_id) <= 998),
  in_reply_to   text,
  refs          text[] NOT NULL DEFAULT '{}',
  send_status   text CHECK (send_status IS NULL OR send_status IN ('sending','sent','failed')),
  send_error    text,
  attempts      integer NOT NULL DEFAULT 0,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES support_tickets(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX support_messages_ticket_idx ON support_messages (tenant_id, ticket_id, created_at);
CREATE UNIQUE INDEX support_messages_mid_idx ON support_messages (tenant_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX support_messages_failed_idx ON support_messages (tenant_id, send_status) WHERE send_status = 'failed';

CREATE TABLE support_files (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id    uuid NOT NULL,
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 10485760),
  data          bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, message_id) REFERENCES support_messages(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX support_files_message_idx ON support_files (tenant_id, message_id);

CREATE TABLE support_macros (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX support_macros_name_idx ON support_macros (tenant_id, lower(name));

-- Response-time targets in minutes; NULL means no target for that priority.
CREATE TABLE support_targets (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  priority           text NOT NULL CHECK (priority IN ('low','normal','high','urgent')),
  first_response_min integer CHECK (first_response_min IS NULL OR first_response_min BETWEEN 1 AND 525600),
  resolution_min     integer CHECK (resolution_min IS NULL OR resolution_min BETWEEN 1 AND 525600),
  PRIMARY KEY (tenant_id, priority)
);

-- Where the mailbox fetch left off (per IMAP folder UIDVALIDITY), and how the last run went.
CREATE TABLE support_sync (
  tenant_id     uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  mailbox_key   text,
  uid_validity  bigint,
  last_uid      bigint NOT NULL DEFAULT 0,
  last_run_at   timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  imported      integer NOT NULL DEFAULT 0
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['support_tickets','support_messages','support_files','support_macros','support_targets','support_sync'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets, support_messages, support_files, support_macros, support_targets, support_sync TO office_app;
