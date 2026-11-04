-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Durable sub-steps within one operation. The proxy replays an unfinished
-- operation from the top of the method; a completed step is skipped on replay
-- and its outcome reused, so a submitted order is not submitted twice.
--
-- `scope` namespaces a step: the operation id alone is not unique, which is why
-- the operations unique index had to become (method, inputs). Callers get a
-- scope-bound executor rather than passing scope per call, so one plugin cannot
-- read another's steps.
CREATE TABLE IF NOT EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.operation_steps(
  scope VARCHAR(255) NOT NULL,
  operation_id VARCHAR(255) NOT NULL,
  step_name VARCHAR(255) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state VARCHAR(16) NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  -- NULL means no attempt is in flight: the body threw and released the claim,
  -- so the next caller takes over at once. A process that died leaves this set,
  -- so its claim is honoured until takeoverAfterMs has passed.
  attempt_started_at TIMESTAMPTZ,
  first_started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ,
  output JSONB,
  PRIMARY KEY (scope, operation_id, step_name)
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Uniqueness spanning operations, which a per-operation step cannot express:
-- one ledger burn settles exactly one redemption.
CREATE TABLE IF NOT EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.resource_claims(
  namespace VARCHAR(255) NOT NULL,
  resource VARCHAR(255) NOT NULL,
  operation_id VARCHAR(255) NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (namespace, resource)
);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
DROP TABLE IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.resource_claims;
DROP TABLE IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.operation_steps;
-- +goose StatementEnd
-- +goose ENVSUB OFF
