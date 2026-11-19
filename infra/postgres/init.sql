-- Dev roles. Prod: create via IaC with secrets from KMS/Vault.
CREATE ROLE office_app LOGIN PASSWORD 'office_app' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE office_relay LOGIN PASSWORD 'office_relay' NOSUPERUSER BYPASSRLS;
