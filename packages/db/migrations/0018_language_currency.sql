-- Language and currency choices. All optional (null = not chosen yet: the app uses the browser's language / EUR).
-- users.ui_locale: the language this person picked (e.g. "es", "nl"). users.ui_currency: the currency they like to see prices in.
ALTER TABLE users ADD COLUMN ui_locale text CHECK (ui_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$');
ALTER TABLE users ADD COLUMN ui_currency char(3) CHECK (ui_currency ~ '^[A-Z]{3}$');
-- tenants.display_currency: the currency the business wants to see its numbers in. It never changes stored amounts or existing invoices.
ALTER TABLE tenants ADD COLUMN display_currency char(3) CHECK (display_currency ~ '^[A-Z]{3}$');
