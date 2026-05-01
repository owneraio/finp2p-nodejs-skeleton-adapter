-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.account_mappings(
  fin_id VARCHAR(255) NOT NULL,
  account VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (fin_id, account)
);
CREATE INDEX account_mappings_fin_id_idx ON ${LEDGER_SCHEMA:-ledger_adapter}.account_mappings(fin_id, created_at, account);
CREATE INDEX account_mappings_account_idx ON ${LEDGER_SCHEMA:-ledger_adapter}.account_mappings(account, created_at, fin_id);
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.account_mappings TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE ${LEDGER_SCHEMA:-ledger_adapter}.account_mappings;
-- +goose ENVSUB OFF
-- +goose StatementEnd
