-- Mail v1: every person's own mailbox inside Office.
-- Privacy: besides the business (tenant_id), every row belongs to ONE person (user_id) and the database only shows a row
-- to that person. The module says who is asking with `select set_config('app.mail_user', <user id>, true)` at the start of
-- each request; with nothing set, nothing is visible (fails closed). Not even owners or admins can read someone's mail.
-- No mailbox password is ever stored here: the mail provider holds its own access (see README).

CREATE FUNCTION mail_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.mail_user', true), '')::uuid $$;

CREATE TABLE mail_accounts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  address        text NOT NULL CHECK (address = lower(address)),
  display_name   text NOT NULL,
  -- workmail: a mailbox bought through the Work email feature. local: a pretend/own mailbox (development, tests).
  source         text NOT NULL CHECK (source IN ('workmail', 'local')),
  -- Work email's mailbox id (no password, nothing secret).
  provider_ref   text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  signature      text NOT NULL DEFAULT '' CHECK (char_length(signature) <= 2000),
  -- Where the last fetch from the provider stopped, and when it ran.
  sync_cursor    text,
  last_synced_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE mail_labels (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  color      text NOT NULL DEFAULT 'gray',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX mail_labels_name_uq ON mail_labels (tenant_id, user_id, lower(name));

CREATE TABLE mail_messages (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  account_id     uuid NOT NULL,
  -- Conversation: messages that answer each other share a thread.
  thread_id      uuid NOT NULL,
  folder         text NOT NULL CHECK (folder IN ('inbox', 'sent', 'drafts', 'spam', 'trash', 'archive')),
  -- The provider's id for this message (to never fetch it twice).
  remote_uid     text,
  message_id_hdr text,
  in_reply_to    text,
  refs           text[] NOT NULL DEFAULT '{}',
  from_name      text NOT NULL DEFAULT '',
  from_email     text NOT NULL DEFAULT '',
  to_addrs       jsonb NOT NULL DEFAULT '[]',
  cc_addrs       jsonb NOT NULL DEFAULT '[]',
  bcc_addrs      jsonb NOT NULL DEFAULT '[]',
  subject        text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 998),
  -- The subject without "Re:" / "Fwd:" and in lower case, to join replies that lost their headers to the conversation.
  subject_norm   text NOT NULL DEFAULT '',
  body_text      text NOT NULL DEFAULT '',
  -- Already cleaned of anything that could run (see sanitize.ts); shown in a locked box in the app.
  body_html      text,
  snippet        text NOT NULL DEFAULT '',
  is_read        boolean NOT NULL DEFAULT false,
  is_starred     boolean NOT NULL DEFAULT false,
  has_attachments boolean NOT NULL DEFAULT false,
  -- Remote pictures in the mail were blocked while cleaning (the reader may allow them).
  has_remote_images boolean NOT NULL DEFAULT false,
  -- When it was sent/received (a draft: when last saved).
  date           timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES mail_accounts(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX mail_messages_folder_idx ON mail_messages (tenant_id, user_id, folder, date DESC);
CREATE INDEX mail_messages_thread_idx ON mail_messages (tenant_id, user_id, thread_id);
CREATE INDEX mail_messages_hdr_idx ON mail_messages (tenant_id, user_id, message_id_hdr);
CREATE UNIQUE INDEX mail_messages_remote_uq ON mail_messages (tenant_id, account_id, remote_uid) WHERE remote_uid IS NOT NULL;

CREATE TABLE mail_attachments (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  message_id   uuid NOT NULL,
  name         text NOT NULL,
  content_type text NOT NULL,
  size_bytes   integer NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 26214400),
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES mail_messages(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX mail_attachments_msg_idx ON mail_attachments (tenant_id, message_id);

CREATE TABLE mail_message_labels (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  message_id uuid NOT NULL,
  label_id   uuid NOT NULL,
  PRIMARY KEY (message_id, label_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES mail_messages(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, label_id) REFERENCES mail_labels(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX mail_message_labels_label_idx ON mail_message_labels (tenant_id, user_id, label_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mail_accounts','mail_labels','mail_messages','mail_attachments','mail_message_labels'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY person_isolation ON %I USING (tenant_id = app_tenant_id() AND user_id = mail_user_id()) WITH CHECK (tenant_id = app_tenant_id() AND user_id = mail_user_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_accounts, mail_labels, mail_messages, mail_attachments, mail_message_labels TO office_app;
