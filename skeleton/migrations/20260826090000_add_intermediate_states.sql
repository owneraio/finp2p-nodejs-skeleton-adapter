-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Per-operation checkpoints for resumable workflows. Each entry is an opaque
-- string the consumer serializes itself; defaults to an empty array so existing
-- rows and the proxy's saveOperation (which doesn't set it) keep working.
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.operations
  ADD COLUMN intermediate_states TEXT[] NOT NULL DEFAULT '{}';
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.operations
  DROP COLUMN intermediate_states;
-- +goose StatementEnd
-- +goose ENVSUB OFF
