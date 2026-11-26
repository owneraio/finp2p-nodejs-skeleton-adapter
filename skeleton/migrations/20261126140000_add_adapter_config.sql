-- The adapter's configuration (config.PgConfigBackend): each field's value by
-- field id, and the applied version with the values it was applied with, the
-- current one only, so a replaced secret does not stay behind. Every value is
-- sealed by the adapter before it is written (v1.r.<kid>.… with the keyring,
-- kms1.… with KMS); the database never holds one in the clear.
--
-- IF NOT EXISTS because adapters created these tables under their own
-- migration history before the skeleton had them: the columns are the same,
-- so their rows read as they are. Such an adapter makes its own migration
-- IF NOT EXISTS too, since it runs after this one: a plain CREATE would fail
-- on a fresh database.

-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE TABLE IF NOT EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_config_values(
  field_id VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_config_applied(
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version INTEGER NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  field_values TEXT NOT NULL
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
        SELECT EXISTS(
            SELECT 1 FROM pg_catalog.pg_roles
            WHERE rolname = ledger_adapter_user
        )
        INTO users_exist;

        IF users_exist THEN
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.adapter_config_values TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.adapter_config_applied TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_config_applied;
DROP TABLE IF EXISTS ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.adapter_config_values;
-- +goose ENVSUB OFF
-- +goose StatementEnd
