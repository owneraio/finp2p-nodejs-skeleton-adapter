-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.network_accounts(
  -- used by DELETE /accounts/{accountId}
  account_id VARCHAR(255) PRIMARY KEY,
  idempotency_key VARCHAR(255),
  organization_id VARCHAR(255) NOT NULL,
  asset_id VARCHAR(255) NOT NULL,
  account JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX network_accounts_idempotency_key_idx
  ON ${LEDGER_SCHEMA:-ledger_adapter}.network_accounts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.network_accounts TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE ${LEDGER_SCHEMA:-ledger_adapter}.network_accounts;
-- +goose ENVSUB OFF
-- +goose StatementEnd
