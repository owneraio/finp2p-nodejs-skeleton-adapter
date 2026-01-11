-- +goose Up
-- +goose StatementBegin
CREATE TABLE ledger_adapter.assets(
  asset_id VARCHAR(255) PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  decimals INTEGER NOT NULL,
  contract_address VARCHAR(255) NOT NULL UNIQUE,
  contract_abi VARCHAR(255)
)
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE ledger_adapter.assets TO %I;', ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE ledger_adapter.assets;
-- +goose StatementEnd
