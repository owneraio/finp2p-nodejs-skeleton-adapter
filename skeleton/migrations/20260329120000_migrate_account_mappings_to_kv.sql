-- +goose Up
-- +goose StatementBegin
-- Migrate account_mappings from (fin_id, account) to (fin_id, field_name, value)
-- to align with the Java skeleton's key-value storage model.

-- 1. Drop old indexes
DROP INDEX IF EXISTS ledger_adapter.account_mappings_fin_id_idx;
DROP INDEX IF EXISTS ledger_adapter.account_mappings_account_idx;

-- 2. Rename the old column and add new columns
ALTER TABLE ledger_adapter.account_mappings
  ADD COLUMN field_name VARCHAR(255),
  ADD COLUMN value VARCHAR(255);

-- 3. Migrate existing data: old "account" column becomes field_name='ledgerAccountId'
UPDATE ledger_adapter.account_mappings
SET field_name = 'ledgerAccountId', value = account;

-- 4. Make new columns NOT NULL and drop old column
ALTER TABLE ledger_adapter.account_mappings
  ALTER COLUMN field_name SET NOT NULL,
  ALTER COLUMN value SET NOT NULL;

ALTER TABLE ledger_adapter.account_mappings DROP CONSTRAINT account_mappings_pkey;
ALTER TABLE ledger_adapter.account_mappings DROP COLUMN account;
ALTER TABLE ledger_adapter.account_mappings ADD PRIMARY KEY (fin_id, field_name);

-- 5. Create indexes matching Java skeleton
CREATE INDEX idx_account_mappings_fin_id ON ledger_adapter.account_mappings (fin_id);
CREATE INDEX idx_account_mappings_value ON ledger_adapter.account_mappings (value, field_name);
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE ledger_adapter.account_mappings TO %I;', ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS ledger_adapter.idx_account_mappings_fin_id;
DROP INDEX IF EXISTS ledger_adapter.idx_account_mappings_value;

ALTER TABLE ledger_adapter.account_mappings
  ADD COLUMN account VARCHAR(255);

UPDATE ledger_adapter.account_mappings
SET account = value
WHERE field_name = 'ledgerAccountId';

ALTER TABLE ledger_adapter.account_mappings DROP CONSTRAINT account_mappings_pkey;
ALTER TABLE ledger_adapter.account_mappings DROP COLUMN field_name;
ALTER TABLE ledger_adapter.account_mappings DROP COLUMN value;
ALTER TABLE ledger_adapter.account_mappings ALTER COLUMN account SET NOT NULL;
ALTER TABLE ledger_adapter.account_mappings ADD PRIMARY KEY (fin_id, account);

CREATE INDEX account_mappings_fin_id_idx ON ledger_adapter.account_mappings(fin_id, created_at, account);
CREATE INDEX account_mappings_account_idx ON ledger_adapter.account_mappings(account, created_at, fin_id);
-- +goose StatementEnd
