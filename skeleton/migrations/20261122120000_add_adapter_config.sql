-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- The adapter config document (adapter-config/3): 1 row. `config` holds the
-- sections (`ledgers` by CAIP-2, `custody`). Secret values are sealed
-- envelopes in place (src/config/types.ts SealedValue); the private half of
-- the wrapping key is in KMS or in adapter_keys, never in this table.
CREATE TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_config (
  id          TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  version     TEXT NOT NULL,
  revision    INTEGER NOT NULL,
  config      JSONB NOT NULL,
  actor       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Key pair of LocalRsaSealer (no KMS). Unused when KMS holds the key.
CREATE TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_keys (
  kid              TEXT PRIMARY KEY,
  private_key_pem  TEXT NOT NULL,
  public_key_spki  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- +goose ENVSUB OFF
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
    DECLARE
-- +goose ENVSUB ON
        ledger_adapter_user TEXT := '${LEDGER_ADAPTER_USER:-}';
        ledger_adapter_schema TEXT := '${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}';
-- +goose ENVSUB OFF
        users_exist BOOLEAN;
    BEGIN
        SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ledger_adapter_user) INTO users_exist;
        IF users_exist THEN
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.adapter_config TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.adapter_keys TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_keys;
DROP TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_config;
-- +goose ENVSUB OFF
-- +goose StatementEnd
