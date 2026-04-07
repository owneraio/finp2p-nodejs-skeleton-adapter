-- +goose Up
-- +goose StatementBegin

-- Network mapping registry: key-value pairs per networkId (e.g. chainId, rpcUrl)
-- Parallel to account_mappings but keyed by networkId instead of finId.
CREATE TABLE ledger_adapter.network_mappings (
  network_id VARCHAR(255) NOT NULL,
  field_name VARCHAR(255) NOT NULL,
  value      VARCHAR(1024) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (network_id, field_name)
);

CREATE INDEX idx_network_mappings_network_id ON ledger_adapter.network_mappings (network_id);
CREATE INDEX idx_network_mappings_value ON ledger_adapter.network_mappings (value, field_name);

-- Add network_id to assets table (nullable for existing rows)
ALTER TABLE ledger_adapter.assets ADD COLUMN network_id VARCHAR(255);
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE ledger_adapter.network_mappings TO %I;', ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE ledger_adapter.assets DROP COLUMN IF EXISTS network_id;
DROP TABLE IF EXISTS ledger_adapter.network_mappings;
-- +goose StatementEnd
