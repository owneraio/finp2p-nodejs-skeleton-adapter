-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Widen token_standard from ENUM('ERC20') to VARCHAR to support plugin-delivered standards.
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets
  ALTER COLUMN token_standard TYPE VARCHAR(255) USING token_standard::VARCHAR;
DROP TYPE IF EXISTS ${LEDGER_SCHEMA:-ledger_adapter}.token_standard;
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
CREATE TYPE ${LEDGER_SCHEMA:-ledger_adapter}.token_standard AS ENUM('ERC20');
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets
  ALTER COLUMN token_standard TYPE ${LEDGER_SCHEMA:-ledger_adapter}.token_standard USING token_standard::${LEDGER_SCHEMA:-ledger_adapter}.token_standard;
-- +goose StatementEnd
-- +goose ENVSUB OFF
