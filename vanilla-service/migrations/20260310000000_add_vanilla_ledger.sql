-- +goose Up
-- +goose StatementBegin
CREATE SCHEMA IF NOT EXISTS ledger_adapter;

CREATE TABLE ledger_adapter.accounts(
  fin_id VARCHAR(255) NOT NULL,
  asset_id VARCHAR(255) NOT NULL,
  asset_type VARCHAR(64) NOT NULL DEFAULT 'finp2p',
  balance NUMERIC NOT NULL DEFAULT 0,
  held NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fin_id, asset_id, asset_type),
  CHECK (balance >= 0),
  CHECK (held >= 0 AND held <= balance)
);

CREATE TABLE ledger_adapter.transactions(
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
CREATE UNIQUE INDEX tx_idempotency_idx ON ledger_adapter.transactions ((details->>'idempotency_key'));
CREATE INDEX tx_operation_idx ON ledger_adapter.transactions ((details->>'operation_id'));
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE ledger_adapter.accounts TO %I;', ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE ledger_adapter.transactions TO %I;', ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS ledger_adapter.transactions;
DROP TABLE IF EXISTS ledger_adapter.accounts;
-- +goose StatementEnd
