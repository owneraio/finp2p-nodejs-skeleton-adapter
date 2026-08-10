-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.investor_whitelist(
  -- a party is either an investor finId or a raw ledger address: an escrow
  -- custody wallet has no finId, and cleaning up a replaced mapping leaves only
  -- an address
  party_type VARCHAR(16) NOT NULL CHECK (party_type IN ('finId', 'address')),
  party_id VARCHAR(255) NOT NULL,
  asset_id VARCHAR(255) NOT NULL,
  -- arbitrary adapter-defined config, stored verbatim
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (party_type, party_id, asset_id)
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
