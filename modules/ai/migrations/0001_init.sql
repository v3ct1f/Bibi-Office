-- AI summaries: meeting notes and support tickets summarised by Claude, with action items and follow-up drafts.

CREATE TABLE ai_summaries (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('meeting','ticket')),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  visibility         text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','private')),
  -- What was summarised: the pasted or uploaded notes (meetings), or the ticket's conversation.
  source_text        text NOT NULL CHECK (char_length(source_text) BETWEEN 1 AND 400000),
  source_name        text CHECK (char_length(source_name) <= 255),
  -- Ticket summaries: the Support ticket and its label ("T-12 Broken oven").
  source_ref         uuid,
  source_label       text CHECK (char_length(source_label) <= 300),
  meeting_date       date,
  attendees          jsonb NOT NULL DEFAULT '[]',
  contact_id         uuid,
  deal_id            uuid,
  -- Result (editable afterwards)
  summary            text NOT NULL CHECK (char_length(summary) <= 20000),
  key_points         jsonb NOT NULL DEFAULT '[]',
  decisions          jsonb NOT NULL DEFAULT '[]',
  open_questions     jsonb NOT NULL DEFAULT '[]',
  follow_up_subject  text CHECK (char_length(follow_up_subject) <= 300),
  follow_up_body     text CHECK (char_length(follow_up_body) <= 20000),
  suggested_reply    text CHECK (char_length(suggested_reply) <= 20000),
  model              text NOT NULL,
  input_tokens       integer NOT NULL DEFAULT 0,
  output_tokens      integer NOT NULL DEFAULT 0,
  edited             boolean NOT NULL DEFAULT false,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX ai_summaries_list_idx ON ai_summaries (tenant_id, kind, created_at DESC);
CREATE INDEX ai_summaries_ticket_idx ON ai_summaries (tenant_id, source_ref, created_at DESC) WHERE source_ref IS NOT NULL;
CREATE INDEX ai_summaries_contact_idx ON ai_summaries (tenant_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX ai_summaries_deal_idx ON ai_summaries (tenant_id, deal_id) WHERE deal_id IS NOT NULL;

CREATE TABLE ai_action_items (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  summary_id     uuid NOT NULL,
  position       integer NOT NULL,
  text           text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  owner_name     text CHECK (char_length(owner_name) <= 200),
  owner_user_id  uuid,
  due_on         date,
  -- Set once turned into a core task.
  task_id        uuid,
  FOREIGN KEY (tenant_id, summary_id) REFERENCES ai_summaries(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ai_action_items_summary_idx ON ai_action_items (tenant_id, summary_id, position);

-- Every call to the AI service, for the monthly limit and the usage page (kept when summaries are deleted).
CREATE TABLE ai_usage (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  at             timestamptz NOT NULL DEFAULT now(),
  purpose        text NOT NULL CHECK (purpose IN ('meeting','ticket','test')),
  model          text NOT NULL,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  user_id        uuid
);
CREATE INDEX ai_usage_month_idx ON ai_usage (tenant_id, at);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_summaries','ai_action_items','ai_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_summaries, ai_action_items, ai_usage TO office_app;
