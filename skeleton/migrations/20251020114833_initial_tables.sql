-- +goose Up
-- +goose StatementBegin
CREATE TYPE OperationStatus as ENUM('queued', 'in_progress', 'succeeded', 'failed', 'unknown');
CREATE SEQUENCE operation_cid_seq;

CREATE TABLE operations(
  cid VARCHAR(255) PRIMARY KEY DEFAULT ('CID-' || nextval('operation_cid_seq')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  method VARCHAR(255) NOT NULL,
  status OperationStatus NOT NULL,
  inputs JSONB NOT NULL,
  outputs JSONB NOT NULL
);
CREATE INDEX operations_status_idx ON operations(status);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE operations;
DROP TYPE OperationStatus;
DROP SEQUENCE operation_cid_seq;
-- +goose StatementEnd
