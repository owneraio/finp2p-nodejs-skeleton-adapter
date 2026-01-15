-- +goose Up
-- +goose StatementBegin
CREATE TYPE ledger_adapter.token_standard as ENUM('ERC20');

CREATE TABLE ledger_adapter.assets(
  type VARCHAR(255) NOT NULL,
  id VARCHAR(255) NOT NULL,
  -- composite primary key
  PRIMARY KEY (type, id),

  token_standard ledger_adapter.token_standard NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  decimals INTEGER NOT NULL,
  contract_address VARCHAR(255) NOT NULL
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
DROP TYPE ledger_adapter.token_standard;
-- +goose StatementEnd
