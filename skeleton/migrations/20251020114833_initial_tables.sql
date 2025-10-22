-- +goose Up
-- +goose StatementBegin
CREATE TYPE OperationStatus as ENUM('in_progress', 'succeeded', 'failed');
CREATE SEQUENCE operation_cid_seq;

CREATE TABLE operations(
  id SERIAL PRIMARY KEY,
  cid VARCHAR(255) UNIQUE NOT NULL DEFAULT 'CID-' || nextval('operation_cid_seq'),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  method VARCHAR(255) NOT NULL,
  status OperationStatus NOT NULL,
  arguments JSONB NOT NULL
);

CREATE INDEX operations_status_idx ON operations(status);
CREATE INDEX operations_cid_idx ON operations(cid);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE operations;
DROP TYPE OperationStatus;
DROP SEQUENCE operation_cid_seq;
-- +goose StatementEnd
