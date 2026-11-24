-- Messages v1: chats between colleagues of one business.
-- A conversation is "direct" (exactly two people, one per pair: direct_key = the two user ids sorted) or a named "group".
-- Only members can read a conversation (checked by the module; RLS keeps businesses apart).

CREATE TABLE messages_conversations (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('direct', 'group')),
  name             text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 100),
  direct_key       text,
  created_by       uuid,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, direct_key),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK ((kind = 'group') = (name IS NOT NULL))
);

CREATE TABLE messages_members (
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  user_id          uuid NOT NULL,
  role             text NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
  last_read_at     timestamptz NOT NULL DEFAULT now(),
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES messages_conversations(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX messages_members_user_idx ON messages_members (tenant_id, user_id);

CREATE TABLE messages_files (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  name             text NOT NULL,
  content_type     text NOT NULL,
  size_bytes       integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data             bytea NOT NULL,
  uploaded_by      uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES messages_conversations(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE messages_messages (
  id               uuid PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  uuid NOT NULL,
  sender_id        uuid,
  kind             text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'system')),
  body             text NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
  file_id          uuid,
  edited_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, conversation_id) REFERENCES messages_conversations(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, file_id) REFERENCES messages_files(tenant_id, id) ON DELETE SET NULL (file_id)
);
CREATE INDEX messages_messages_conv_idx ON messages_messages (tenant_id, conversation_id, id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['messages_conversations','messages_members','messages_files','messages_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON messages_conversations, messages_members, messages_files, messages_messages TO office_app;
