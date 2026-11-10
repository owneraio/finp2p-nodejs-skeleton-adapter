-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- Durable sub-steps within one operation. The proxy replays an unfinished
-- operation from the top of the method; a completed step is skipped on replay
-- and its outcome reused, so a submitted order is not submitted twice.
--
-- `scope` namespaces a step to one plugin on one ledger (or to the adapter's
-- own code). Callers get a scope-bound executor rather than passing scope per
-- call, so one plugin cannot read another's steps.
--
-- `method` is part of the key because `operation_id` is typically the caller's
-- idempotency key, which carries no method — the same reason the operations
-- unique index is (method, inputs). Without it, `issue` and `redeem` arriving
-- under one key would share any step name they have in common, and the second
-- would read the first's outcome.
--
-- An adapter embedding a plugin host creates these same two tables with the
-- same shape from its own migration; whichever runs first creates them, so
-- each create is conditional and the columns must match exactly.
CREATE TABLE IF NOT EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.operation_steps(
  scope VARCHAR(255) NOT NULL,
  method VARCHAR(64) NOT NULL,
  operation_id VARCHAR(255) NOT NULL,
  step_name VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  -- 'running': an attempt is in flight, honoured until takeoverAfterMs passes.
  -- 'open':    no attempt in flight — the body threw and released it, so the
  --            next caller takes over at once. A process that died instead
  --            leaves the row 'running' and its claim simply ages out.
  -- 'done':    an outcome is stored in `output` and the body never runs again.
  state VARCHAR(16) NOT NULL CHECK (state IN ('running', 'open', 'done')),
  attempt INTEGER NOT NULL,
  first_started_at TIMESTAMPTZ NOT NULL,
  attempt_started_at TIMESTAMPTZ NOT NULL,
  output JSONB,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, method, operation_id, step_name)
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Uniqueness spanning operations, which a per-operation step cannot express:
-- one ledger burn settles exactly one redemption.
CREATE TABLE IF NOT EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.resource_claims(
  scope VARCHAR(255) NOT NULL,
  namespace VARCHAR(128) NOT NULL,
  resource VARCHAR(255) NOT NULL,
  operation_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, namespace, resource)
);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose StatementBegin
-- The runtime role is granted separately from table creation, as every other
-- table migration does: a deployment that runs migrations as an owner and the
-- adapter as LEDGER_ADAPTER_USER gets permission errors on the new tables
-- otherwise.
DO $$
    DECLARE
-- +goose ENVSUB ON
        ledger_adapter_user TEXT := '${LEDGER_ADAPTER_USER:-}';
        ledger_adapter_schema TEXT := '${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}';
-- +goose ENVSUB OFF
        users_exist BOOLEAN;
    BEGIN
        SELECT EXISTS(
            SELECT 1 FROM pg_catalog.pg_roles
            WHERE rolname = ledger_adapter_user
        )
        INTO users_exist;

        IF users_exist THEN
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.operation_steps TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.resource_claims TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
DROP TABLE IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.resource_claims;
DROP TABLE IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.operation_steps;
-- +goose StatementEnd
-- +goose ENVSUB OFF
