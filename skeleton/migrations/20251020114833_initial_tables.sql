-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE SCHEMA IF NOT EXISTS ${LEDGER_SCHEMA:-ledger_adapter};
CREATE TYPE ${LEDGER_SCHEMA:-ledger_adapter}.operation_status as ENUM('in_progress', 'succeeded', 'failed');
CREATE SEQUENCE IF NOT EXISTS ${LEDGER_SCHEMA:-ledger_adapter}.operation_cid_seq;

CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.operations(
  cid VARCHAR(255) PRIMARY KEY DEFAULT ('CID-' || nextval('${LEDGER_SCHEMA:-ledger_adapter}.operation_cid_seq')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  method VARCHAR(255) NOT NULL,
  status ${LEDGER_SCHEMA:-ledger_adapter}.operation_status NOT NULL,
  inputs JSONB NOT NULL UNIQUE,
  outputs JSONB NOT NULL
);
CREATE INDEX operations_status_idx ON ${LEDGER_SCHEMA:-ledger_adapter}.operations(status);
-- +goose ENVSUB OFF
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
    DECLARE
-- +goose ENVSUB ON
        ledger_adapter_user TEXT := '${LEDGER_ADAPTER_USER:-}';
        ledger_adapter_schema TEXT := '${LEDGER_SCHEMA:-ledger_adapter}';
-- +goose ENVSUB OFF
        users_exist BOOLEAN;
    BEGIN
        SELECT EXISTS(
            SELECT 1 FROM pg_catalog.pg_roles
            WHERE rolname = ledger_adapter_user
        )
        INTO users_exist;

        IF users_exist THEN
            EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.operations TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE ${LEDGER_SCHEMA:-ledger_adapter}.operations;
DROP TYPE ${LEDGER_SCHEMA:-ledger_adapter}.operation_status;
DROP SEQUENCE ${LEDGER_SCHEMA:-ledger_adapter}.operation_cid_seq;
-- +goose ENVSUB OFF
-- +goose StatementEnd
