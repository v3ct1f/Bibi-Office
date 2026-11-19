-- AI summaries: what was summarized, the structured result, and token usage per month (for caps).

CREATE TABLE ai_summaries (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('meeting', 'email', 'notes')),
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  source_text    text CHECK (length(source_text) <= 200000),            -- null when the tenant chose not to keep sources
  source_chars   integer NOT NULL,
  status         text NOT NULL CHECK (status IN ('done', 'refused')),
  result         jsonb,
  model          text NOT NULL,
  input_tokens   integer NOT NULL DEFAULT 0,
  output_tokens  integer NOT NULL DEFAULT 0,
  tasks_created  integer NOT NULL DEFAULT 0,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (status <> 'done' OR result IS NOT NULL)
);
CREATE INDEX ai_summaries_recent ON ai_summaries (tenant_id, id DESC);

CREATE TABLE ai_usage (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  month          date NOT NULL CHECK (extract(day FROM month) = 1),
  requests       integer NOT NULL DEFAULT 0,
  input_tokens   bigint NOT NULL DEFAULT 0,
  output_tokens  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ai_summaries', 'ai_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_summaries TO office_app;
GRANT SELECT, INSERT, UPDATE ON ai_usage TO office_app;
