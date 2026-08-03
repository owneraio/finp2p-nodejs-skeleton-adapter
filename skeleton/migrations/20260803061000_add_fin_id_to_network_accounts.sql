-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
-- Investor finId the binding was created for. Required on the API; nullable
-- here only because rows recorded before this column existed have no value.
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.network_accounts
  ADD COLUMN fin_id VARCHAR(255);
-- +goose ENVSUB OFF
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.network_accounts
  DROP COLUMN fin_id;
-- +goose ENVSUB OFF
-- +goose StatementEnd
