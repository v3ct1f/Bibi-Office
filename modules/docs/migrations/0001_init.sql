-- Docs & e-sign: a document library (any file) and PDF signature requests.

CREATE TABLE docs_documents (
  id                 uuid PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  -- "" = top level; "Contracts/2026" = nested folders
  folder             text NOT NULL DEFAULT '' CHECK (char_length(folder) <= 200),
  visibility         text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team','private')),
  -- file = just stored; the rest is the life of a signature request
  status             text NOT NULL CHECK (status IN ('file','draft','sent','completed','declined','expired','cancelled')),
  file_name          text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  content_type       text NOT NULL,
  size_bytes         integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256             text NOT NULL,
  data               bytea NOT NULL,
  page_count         integer,
  signed_data        bytea,
  signed_sha256      text,
  ordered            boolean NOT NULL DEFAULT false,
  message            text CHECK (char_length(message) <= 2000),
  expires_on         date,
  remind_every_days  integer NOT NULL DEFAULT 0 CHECK (remind_every_days BETWEEN 0 AND 30),
  -- Where signing links point (the web app's address, saved when sent) and the company name shown to signers.
  app_url            text,
  company_name       text,
  template_id        uuid,
  employee_id        uuid,
  contact_id         uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  completed_at       timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX docs_documents_folder_idx ON docs_documents (tenant_id, folder, updated_at DESC);
CREATE INDEX docs_documents_status_idx ON docs_documents (tenant_id, status) WHERE status = 'sent';
CREATE INDEX docs_documents_employee_idx ON docs_documents (tenant_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX docs_documents_contact_idx ON docs_documents (tenant_id, contact_id) WHERE contact_id IS NOT NULL;

CREATE TABLE docs_signers (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id       uuid NOT NULL,
  position          integer NOT NULL,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  email             text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  user_id           uuid,
  contact_id        uuid,
  -- Secret part of the signing link (set when the request is sent; a new one replaces a leaked link).
  token             text,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','declined')),
  viewed_at         timestamptz,
  signed_at         timestamptz,
  declined_at       timestamptz,
  decline_reason    text CHECK (char_length(decline_reason) <= 1000),
  signature_kind    text CHECK (signature_kind IN ('typed','drawn')),
  signature_text    text,
  signature_image   bytea,
  initials_text     text,
  initials_image    bytea,
  ip                text,
  user_agent        text,
  notified_at       timestamptz,
  last_reminded_at  timestamptz,
  reminders_sent    integer NOT NULL DEFAULT 0,
  mail_error        text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES docs_documents(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX docs_signers_doc_idx ON docs_signers (tenant_id, document_id, position);
CREATE UNIQUE INDEX docs_signers_token_idx ON docs_signers (token) WHERE token IS NOT NULL;
CREATE INDEX docs_signers_user_idx ON docs_signers (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX docs_signers_contact_idx ON docs_signers (tenant_id, contact_id) WHERE contact_id IS NOT NULL;

-- Boxes placed on the pages; positions are fractions of the page (0..1, from the top left).
CREATE TABLE docs_fields (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL,
  signer_id    uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('signature','initials','date','name','text')),
  page         integer NOT NULL CHECK (page >= 1),
  x            real NOT NULL CHECK (x >= 0 AND x <= 1),
  y            real NOT NULL CHECK (y >= 0 AND y <= 1),
  w            real NOT NULL CHECK (w > 0 AND w <= 1),
  h            real NOT NULL CHECK (h > 0 AND h <= 1),
  required     boolean NOT NULL DEFAULT true,
  label        text CHECK (char_length(label) <= 80),
  value        text CHECK (char_length(value) <= 500),
  FOREIGN KEY (tenant_id, document_id) REFERENCES docs_documents(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, signer_id) REFERENCES docs_signers(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX docs_fields_doc_idx ON docs_fields (tenant_id, document_id);

CREATE TABLE docs_templates (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 50000),
  folder      text NOT NULL DEFAULT '' CHECK (char_length(folder) <= 200),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX docs_templates_name_idx ON docs_templates (tenant_id, lower(name));

-- Audit trail of a request; printed on the certificate page of the signed PDF.
CREATE TABLE docs_activity (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  action       text NOT NULL,
  signer_id    uuid,
  actor_name   text,
  ip           text,
  user_agent   text,
  detail       text,
  FOREIGN KEY (tenant_id, document_id) REFERENCES docs_documents(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX docs_activity_doc_idx ON docs_activity (tenant_id, document_id, at);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['docs_documents','docs_signers','docs_fields','docs_templates','docs_activity'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON docs_documents, docs_signers, docs_fields, docs_templates, docs_activity TO office_app;
