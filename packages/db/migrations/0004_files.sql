-- File uploads: documents can be owned by a module ("module-private"): hidden from core document
-- routes and only reachable through that module's ctx.files (which applies the module's own access rules).
ALTER TABLE documents ADD COLUMN module text CHECK (module ~ '^[a-z][a-z0-9-]{1,40}$');
ALTER TABLE documents ADD COLUMN filename text CHECK (length(filename) <= 255);
CREATE INDEX documents_module_idx ON documents (tenant_id, module) WHERE deleted_at IS NULL;
