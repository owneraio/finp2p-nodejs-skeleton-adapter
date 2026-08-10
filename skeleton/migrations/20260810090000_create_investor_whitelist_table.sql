-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.investor_whitelist(
  fin_id VARCHAR(255) NOT NULL,
  asset_id VARCHAR(255) NOT NULL,
  -- arbitrary adapter-defined config, stored verbatim
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fin_id, asset_id)
);
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.investor_whitelist TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE ${LEDGER_SCHEMA:-ledger_adapter}.investor_whitelist;
-- +goose ENVSUB OFF
-- +goose StatementEnd
