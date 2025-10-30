-- +goose Up
-- +goose StatementBegin
CREATE SCHEMA IF NOT EXISTS finp2p_nodejs_skeleton;
CREATE TYPE finp2p_nodejs_skeleton.operation_status as ENUM('queued', 'in_progress', 'succeeded', 'failed', 'unknown');
CREATE SEQUENCE finp2p_nodejs_skeleton.operation_cid_seq;

CREATE TABLE finp2p_nodejs_skeleton.operations(
  cid VARCHAR(255) PRIMARY KEY DEFAULT ('CID-' || nextval('finp2p_nodejs_skeleton.operation_cid_seq')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  method VARCHAR(255) NOT NULL,
  status finp2p_nodejs_skeleton.operation_status NOT NULL,
  inputs JSONB NOT NULL,
  outputs JSONB NOT NULL
);
CREATE INDEX operations_status_idx ON finp2p_nodejs_skeleton.operations(status);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE finp2p_nodejs_skeleton.operations;
DROP TYPE finp2p_nodejs_skeleton.operation_status;
DROP SEQUENCE finp2p_nodejs_skeleton.operation_cid_seq;
-- +goose StatementEnd
