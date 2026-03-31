-- +goose Up
-- +goose StatementBegin
-- Fix idempotency: include method in the unique constraint so that
-- different operations with identical inputs don't collide.
ALTER TABLE ledger_adapter.operations DROP CONSTRAINT IF EXISTS operations_inputs_key;
CREATE UNIQUE INDEX operations_method_inputs_idx ON ledger_adapter.operations (method, inputs);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ledger_adapter.operations_method_inputs_idx;
ALTER TABLE ledger_adapter.operations ADD CONSTRAINT operations_inputs_key UNIQUE (inputs);
-- +goose StatementEnd
