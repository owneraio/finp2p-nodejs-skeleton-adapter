-- +goose Up
-- +goose StatementBegin
CREATE SCHEMA IF NOT EXISTS finp2p_nodejs_skeleton;
CREATE TYPE finp2p_nodejs_skeleton.operation_status as ENUM('in_progress', 'succeeded', 'failed');
CREATE SEQUENCE finp2p_nodejs_skeleton.operation_cid_seq;

CREATE TABLE finp2p_nodejs_skeleton.operations(
  cid VARCHAR(255) PRIMARY KEY DEFAULT ('CID-' || nextval('finp2p_nodejs_skeleton.operation_cid_seq')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  method VARCHAR(255) NOT NULL,
  status finp2p_nodejs_skeleton.operation_status NOT NULL,
  inputs JSONB NOT NULL UNIQUE,
  outputs JSONB NOT NULL
);
CREATE INDEX operations_status_idx ON finp2p_nodejs_skeleton.operations(status);
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
    DECLARE
-- +goose ENVSUB ON
        finp2p_ethereum_user TEXT := '${FIN2P_ETHEREUM_USER:-}';
-- +goose ENVSUB OFF
        users_exist BOOLEAN;
    BEGIN
        SELECT EXISTS(
            SELECT 1 FROM pg_catalog.pg_roles
            WHERE rolname = finp2p_ethereum_user
        )
        INTO users_exist;

        IF users_exist THEN
            EXECUTE format('GRANT USAGE ON SCHEMA finp2p_nodejs_skeleton TO %I;', finp2p_ethereum_user);
            EXECUTE format('GRANT SELECT, UPDATE, DELETE, INSERT ON TABLE finp2p_nodejs_skeleton.operations TO %I;', finp2p_ethereum_user);
        END IF;
    END $$;
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE finp2p_nodejs_skeleton.operations;
DROP TYPE finp2p_nodejs_skeleton.operation_status;
DROP SEQUENCE finp2p_nodejs_skeleton.operation_cid_seq;
-- +goose StatementEnd
