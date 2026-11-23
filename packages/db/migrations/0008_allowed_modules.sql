-- Which features a business may turn on, chosen by the program owner. NULL = every feature (incl. future ones).
ALTER TABLE tenants ADD COLUMN allowed_modules text[];
