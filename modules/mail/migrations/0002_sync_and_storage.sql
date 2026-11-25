-- Mail v2: two-way sync with a real mail server, background fetching, storage limits and Trash/Spam clean-up.

-- A change made in Office (read, star, move) that still has to be written to the mail server.
ALTER TABLE mail_messages ADD COLUMN remote_dirty boolean NOT NULL DEFAULT false;
-- When the message went to Trash or Spam (it is deleted for good some days later).
ALTER TABLE mail_messages ADD COLUMN trashed_at timestamptz;
UPDATE mail_messages SET trashed_at = updated_at WHERE folder IN ('trash', 'spam');
CREATE INDEX mail_messages_dirty_idx ON mail_messages (tenant_id, account_id) WHERE remote_dirty;
CREATE INDEX mail_messages_trashed_idx ON mail_messages (tenant_id, user_id, trashed_at) WHERE trashed_at IS NOT NULL;

-- Why the last fetch from the mail server didn't work (plain words), or null.
ALTER TABLE mail_accounts ADD COLUMN last_sync_error text;

-- Messages deleted for good in Office that still have to be deleted on the mail server.
CREATE TABLE mail_remote_deletions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  account_id uuid NOT NULL,
  remote_uid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, account_id) REFERENCES mail_accounts(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX mail_remote_deletions_acct_idx ON mail_remote_deletions (tenant_id, account_id);
ALTER TABLE mail_remote_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_remote_deletions FORCE ROW LEVEL SECURITY;
CREATE POLICY person_isolation ON mail_remote_deletions
  USING (tenant_id = app_tenant_id() AND user_id = mail_user_id()) WITH CHECK (tenant_id = app_tenant_id() AND user_id = mail_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON mail_remote_deletions TO office_app;
