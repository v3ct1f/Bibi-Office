-- Signed documents from Docs & e-sign are listed in the person's documents as links (the file stays in Docs).
ALTER TABLE hr_documents ALTER COLUMN data DROP NOT NULL;
ALTER TABLE hr_documents ADD COLUMN source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','docs'));
ALTER TABLE hr_documents ADD COLUMN ref_id uuid;
ALTER TABLE hr_documents ADD CONSTRAINT hr_documents_data_check CHECK (source = 'docs' OR data IS NOT NULL);
CREATE UNIQUE INDEX hr_documents_ref_idx ON hr_documents (tenant_id, ref_id) WHERE ref_id IS NOT NULL;
