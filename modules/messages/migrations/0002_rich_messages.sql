-- Messages v2: WhatsApp-style extras.
-- * Files are stored in parts (up to 16 MB: videos, voice notes) and uploaded before the message is sent.
-- * New message kinds: poll, event, contact, sticker, gif. Their details live in `data` (jsonb).
-- * Poll votes and event answers have their own tables; `updated_at` lets open chats pick up changes.

ALTER TABLE messages_files ADD COLUMN complete boolean NOT NULL DEFAULT true;
ALTER TABLE messages_files ADD COLUMN part_count integer NOT NULL DEFAULT 1;
ALTER TABLE messages_files DROP CONSTRAINT IF EXISTS messages_files_size_bytes_check;
ALTER TABLE messages_files ADD CONSTRAINT messages_files_size_check CHECK (size_bytes > 0 AND size_bytes <= 16777216);

CREATE TABLE messages_file_parts (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL,
  idx        integer NOT NULL CHECK (idx >= 0 AND idx < 16),
  data       bytea NOT NULL,
  PRIMARY KEY (file_id, idx),
  FOREIGN KEY (tenant_id, file_id) REFERENCES messages_files(tenant_id, id) ON DELETE CASCADE
);
INSERT INTO messages_file_parts (tenant_id, file_id, idx, data) SELECT tenant_id, id, 0, data FROM messages_files;
ALTER TABLE messages_files DROP COLUMN data;

ALTER TABLE messages_messages DROP CONSTRAINT IF EXISTS messages_messages_kind_check;
ALTER TABLE messages_messages ADD CONSTRAINT messages_messages_kind_check
  CHECK (kind IN ('text', 'system', 'poll', 'event', 'contact', 'sticker', 'gif'));
ALTER TABLE messages_messages ADD COLUMN data jsonb;
ALTER TABLE messages_messages ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE messages_messages SET updated_at = coalesce(deleted_at, edited_at, created_at);

CREATE TABLE messages_poll_votes (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL,
  user_id     uuid NOT NULL,
  option_id   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, option_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages_messages(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE messages_event_answers (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  message_id  uuid NOT NULL,
  user_id     uuid NOT NULL,
  answer      text NOT NULL CHECK (answer IN ('going', 'maybe', 'no')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (tenant_id, message_id) REFERENCES messages_messages(tenant_id, id) ON DELETE CASCADE
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['messages_file_parts','messages_poll_votes','messages_event_answers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages_file_parts, messages_poll_votes, messages_event_answers TO office_app;
