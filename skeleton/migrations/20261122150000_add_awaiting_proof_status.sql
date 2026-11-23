-- +goose NO TRANSACTION
-- Before Postgres 12, ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
-- Each statement is idempotent, so a run that stops halfway is simply run again.

-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- awaiting_proof: a createAccount answered with an account challenge and waits for
-- POST /accounts/{cid}/proof. Not replayed on boot.
ALTER TYPE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.operation_status ADD VALUE IF NOT EXISTS 'awaiting_proof';
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Postgres cannot drop an enum value, so 'awaiting_proof' stays. Every create still on a
-- challenge, parked or claimed by a proof, is failed instead: an older skeleton neither
-- maps nor completes it.
UPDATE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.operations
SET status = 'failed',
    outputs = jsonb_build_object(
      'operation', 'account', 'type', 'failure', 'correlationId', cid,
      'error', jsonb_build_object('code', 1, 'message', 'account challenge withdrawn by a skeleton downgrade')),
    updated_at = NOW()
WHERE method = 'createAccount' AND (status = 'awaiting_proof' OR outputs->>'type' = 'challenge');
-- +goose StatementEnd
-- +goose ENVSUB OFF
