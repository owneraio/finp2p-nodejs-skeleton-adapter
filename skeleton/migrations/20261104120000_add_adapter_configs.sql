-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
-- One row per config slot: kind 'network' (id = the ledger, CAIP-2) or kind
-- 'custody' (id = a name). Secrets are stored sealed (envelope JSON, see
-- src/config/types.ts SealedValue); the private half of the wrapping key is
-- in KMS or in adapter_keys, never in this table. Assets are not bound here:
-- an asset's ledger (CAIP-19 in the asset row) names its network config.
CREATE TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_configs (
  kind        TEXT NOT NULL,
  id          TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  version     INTEGER NOT NULL DEFAULT 1,
  "values"    JSONB NOT NULL,
  secrets     JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, id)
);

-- One default per kind (the network createAsset falls back to).
CREATE UNIQUE INDEX adapter_configs_one_default_per_kind
  ON ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_configs (kind) WHERE is_default;

-- Key pair of LocalRsaSealer (dev / no-KMS deployments). Unused when KMS holds the key.
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.adapter_configs TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.adapter_keys TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_keys;
DROP TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_configs;
-- +goose ENVSUB OFF
-- +goose StatementEnd
