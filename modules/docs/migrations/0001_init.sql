-- Docs & e-sign: templates, documents sent for signature, signers, and an append-only evidence trail.

CREATE TABLE docs_templates (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),       -- document title, may hold {{fields}}
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  archived    boolean NOT NULL DEFAULT false,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX docs_templates_name ON docs_templates (tenant_id, lower(name));

CREATE TABLE docs_documents (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number        integer NOT NULL,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'completed', 'declined', 'voided', 'expired')),
  template_id   uuid,
  contact_id    uuid,
  message       text CHECK (length(message) <= 2000),
  in_order      boolean NOT NULL DEFAULT false,                           -- signers sign one after another
  content_hash  text,                                                     -- sha256 of title + body, fixed at send
  expires_at    timestamptz,
  sent_at       timestamptz,
  completed_at  timestamptz,
  void_reason   text,
  created_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, number),
  FOREIGN KEY (tenant_id, template_id) REFERENCES docs_templates(tenant_id, id),
  CHECK (status = 'draft' OR content_hash IS NOT NULL)
);
CREATE INDEX docs_documents_status ON docs_documents (tenant_id, status, id DESC);

CREATE TABLE docs_signers (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id    uuid NOT NULL,
  position       integer NOT NULL CHECK (position BETWEEN 0 AND 19),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email          text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  status         text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'viewed', 'signed', 'declined')),
  token_hash     bytea,                                                   -- sha256 of the link token; rotated on reminder
  viewed_at      timestamptz,
  signed_at      timestamptz,
  signed_name    text CHECK (length(signed_name) <= 200),
  signature_png  bytea CHECK (octet_length(signature_png) <= 200000),
  signed_ip      text,
  decline_reason text CHECK (length(decline_reason) <= 1000),
  last_sent_at   timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (document_id, position),
  UNIQUE (document_id, email),
  FOREIGN KEY (tenant_id, document_id) REFERENCES docs_documents(tenant_id, id) ON DELETE CASCADE,
  CHECK (status <> 'signed' OR (signed_at IS NOT NULL AND signed_name IS NOT NULL))
);

CREATE TABLE docs_events (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL,
  signer_id    uuid,
  kind         text NOT NULL CHECK (kind IN ('created', 'sent', 'reminded', 'viewed', 'signed', 'declined', 'completed', 'voided', 'expired')),
  actor        text,                                                     -- user ref or signer email
  ip           text,
  detail       jsonb NOT NULL DEFAULT '{}',
  at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (tenant_id, document_id) REFERENCES docs_documents(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX docs_events_document ON docs_events (document_id, at);

-- Once sent, the content is fixed: what was signed is what was sent.
CREATE FUNCTION docs_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.content_hash IS DISTINCT FROM OLD.content_hash) THEN
    RAISE EXCEPTION 'a sent document cannot be edited' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('completed', 'declined', 'voided', 'expired') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'this document is closed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER docs_document_guard_bu BEFORE UPDATE ON docs_documents FOR EACH ROW EXECUTE FUNCTION docs_document_guard();

CREATE FUNCTION docs_signer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('signed', 'declined') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.signed_name IS DISTINCT FROM OLD.signed_name
      OR NEW.signature_png IS DISTINCT FROM OLD.signature_png OR NEW.signed_at IS DISTINCT FROM OLD.signed_at) THEN
    RAISE EXCEPTION 'a signature cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER docs_signer_guard_bu BEFORE UPDATE ON docs_signers FOR EACH ROW EXECUTE FUNCTION docs_signer_guard();

CREATE FUNCTION docs_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;   -- cascade from a deleted tenant
  RAISE EXCEPTION 'the evidence trail is append-only' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER docs_events_immutable_bud BEFORE UPDATE OR DELETE ON docs_events FOR EACH ROW EXECUTE FUNCTION docs_events_immutable();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['docs_templates', 'docs_documents', 'docs_signers', 'docs_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON docs_templates, docs_documents TO office_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON docs_signers TO office_app;   -- delete: only while the document is a draft (service)
GRANT SELECT, INSERT ON docs_events TO office_app;
