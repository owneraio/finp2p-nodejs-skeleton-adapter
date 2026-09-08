-- +goose Up
-- +goose StatementBegin
-- +goose ENVSUB ON
CREATE SCHEMA IF NOT EXISTS ${LEDGER_SCHEMA:-ledger_adapter};

CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_nonces(
  signer_address VARCHAR(42) NOT NULL,
  chain_id BIGINT NOT NULL,
  next_nonce BIGINT NOT NULL,
  PRIMARY KEY (signer_address, chain_id)
);

CREATE TABLE ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_transactions(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signer_address VARCHAR(42) NOT NULL,
  chain_id BIGINT NOT NULL,
  nonce BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'cancelling', 'confirmed', 'failed', 'dropped', 'cancelled')),
  tx_request JSONB NOT NULL,
  attempts JSONB NOT NULL DEFAULT '[]'::jsonb,
  latest_hash VARCHAR(66),
  attempt_count INT NOT NULL DEFAULT 0,
  claimed_until TIMESTAMPTZ,
  last_error TEXT,
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_at TIMESTAMPTZ
);

-- Only one live tx may occupy a nonce; terminal rows keep history without
-- blocking nonce reuse.
CREATE UNIQUE INDEX tx_pool_active_nonce_idx
  ON ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_transactions(signer_address, chain_id, nonce)
  WHERE status IN ('pending', 'submitted', 'cancelling');

CREATE INDEX tx_pool_monitor_idx
  ON ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_transactions(signer_address, chain_id, status);

CREATE INDEX tx_pool_latest_hash_idx
  ON ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_transactions(latest_hash);

CREATE INDEX tx_pool_attempts_gin_idx
  ON ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_transactions USING GIN (attempts jsonb_path_ops);
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
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.tx_pool_nonces TO %I;', ledger_adapter_schema, ledger_adapter_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE %I.tx_pool_transactions TO %I;', ledger_adapter_schema, ledger_adapter_user);
        END IF;
    END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
-- +goose ENVSUB ON
DROP TABLE ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_transactions;
DROP TABLE ${LEDGER_SCHEMA:-ledger_adapter}.tx_pool_nonces;
-- +goose ENVSUB OFF
-- +goose StatementEnd
