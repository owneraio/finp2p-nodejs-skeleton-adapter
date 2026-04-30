-- +goose Up
-- Skeleton migrations create the configured schema and account_mappings table.
-- This migration only adds vanilla-service specific tables: accounts and transactions.

-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.accounts(
  id BIGSERIAL PRIMARY KEY,
  fin_id VARCHAR(255) NOT NULL,
  asset_id VARCHAR(255) NOT NULL,
  asset_type VARCHAR(64) NOT NULL DEFAULT 'finp2p',
  balance NUMERIC NOT NULL DEFAULT 0,
  held NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (fin_id, asset_id, asset_type),
  CHECK (balance >= 0),
  CHECK (held >= 0 AND held <= balance)
);

CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.transactions(
  id VARCHAR(50) PRIMARY KEY,
  asset_id VARCHAR(255) NOT NULL,
  asset_type VARCHAR(64) NOT NULL DEFAULT 'finp2p',
  source VARCHAR(255),
  destination VARCHAR(255),
  amount NUMERIC NOT NULL DEFAULT 0,
  source_held NUMERIC NOT NULL DEFAULT 0,
  destination_held NUMERIC NOT NULL DEFAULT 0,
  action VARCHAR(64) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX tx_idempotency_idx ON ${LEDGER_SCHEMA:-ledger_adapter}.transactions ((details->>'idempotency_key'));
CREATE INDEX tx_operation_idx ON ${LEDGER_SCHEMA:-ledger_adapter}.transactions ((details->>'operation_id'));
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.accounts TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I.accounts_id_seq TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.transactions TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE IF EXISTS ${LEDGER_SCHEMA:-ledger_adapter}.transactions;
DROP TABLE IF EXISTS ${LEDGER_SCHEMA:-ledger_adapter}.accounts;
-- +goose ENVSUB OFF
-- +goose StatementEnd
