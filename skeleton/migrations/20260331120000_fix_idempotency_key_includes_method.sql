-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Fix idempotency: include method in the unique constraint so that
-- different operations with identical inputs don't collide.
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.operations DROP CONSTRAINT IF EXISTS operations_inputs_key;
CREATE UNIQUE INDEX operations_method_inputs_idx ON ${LEDGER_SCHEMA:-ledger_adapter}.operations (method, inputs);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- NOTE: This rollback will fail if different methods have rows with identical
-- inputs (the old UNIQUE(inputs) constraint can't hold both). This is expected —
-- the migration is a one-way schema evolution. Rollback is only safe on
-- empty/test databases or before any cross-method input collisions exist.
-- +goose ENVSUB ON
-- +goose StatementBegin
DROP INDEX IF EXISTS ${LEDGER_SCHEMA:-ledger_adapter}.operations_method_inputs_idx;
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.operations ADD CONSTRAINT operations_inputs_key UNIQUE (inputs);
-- +goose StatementEnd
-- +goose ENVSUB OFF
