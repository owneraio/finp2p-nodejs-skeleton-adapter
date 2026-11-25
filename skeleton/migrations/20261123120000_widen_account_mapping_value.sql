-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- A mapping value can be an encrypted token (a JWT, say), which does not fit VARCHAR(255).
-- The btree index on (value, field_name) would still cap it: btree refuses an entry over
-- about 2.7 KB, and encrypted values do not compress. Lookups by value are equality only
-- (getByFieldValue), which a hash index serves at any length.
DROP INDEX IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.idx_account_mappings_value;
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.account_mappings
  ALTER COLUMN value TYPE TEXT;
CREATE INDEX idx_account_mappings_value ON ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.account_mappings USING hash (value);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Fails if any value is now longer than 255 characters; nothing is truncated.
DROP INDEX IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.idx_account_mappings_value;
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.account_mappings
  ALTER COLUMN value TYPE VARCHAR(255);
CREATE INDEX idx_account_mappings_value ON ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.account_mappings (value, field_name);
-- +goose StatementEnd
-- +goose ENVSUB OFF
