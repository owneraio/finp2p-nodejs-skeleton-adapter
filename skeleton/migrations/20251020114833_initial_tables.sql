-- +goose Up
-- +goose StatementBegin
CREATE SCHEMA IF NOT EXISTS ledger_adapter;
CREATE TYPE ledger_adapter.operation_status as ENUM('in_progress', 'succeeded', 'failed');
CREATE SEQUENCE IF NOT EXISTS ledger_adapter.operation_cid_seq;

CREATE TABLE ledger_adapter.operations(
  cid VARCHAR(255) PRIMARY KEY DEFAULT ('CID-' || nextval('ledger_adapter.operation_cid_seq')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  method VARCHAR(255) NOT NULL,
  status ledger_adapter.operation_status NOT NULL,
  inputs JSONB NOT NULL UNIQUE,
  outputs JSONB NOT NULL
);
CREATE INDEX operations_status_idx ON ledger_adapter.operations(status);
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
    DECLARE
-- +goose ENVSUB ON
        ledger_adapter_user TEXT := '${LEDGER_ADAPTER_USER:-}';
-- +goose ENVSUB OFF
        users_exist BOOLEAN;
    BEGIN
        SELECT EXISTS(
            SELECT 1 FROM pg_catalog.pg_roles
            WHERE rolname = ledger_adapter_user
        )
        INTO users_exist;

        IF users_exist THEN
            EXECUTE format('GRANT USAGE ON SCHEMA ledger_adapter TO %I;', ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE ledger_adapter.operations TO %I;', ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE ledger_adapter.operations;
DROP TYPE ledger_adapter.operation_status;
DROP SEQUENCE ledger_adapter.operation_cid_seq;
-- +goose StatementEnd
