-- Workflows run with the access of a person: whoever last saved them (not with full access).
ALTER TABLE workflows ADD COLUMN run_as uuid REFERENCES users(id);
UPDATE workflows SET run_as = created_by;
