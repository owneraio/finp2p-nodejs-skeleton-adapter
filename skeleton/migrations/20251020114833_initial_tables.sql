-- +goose Up
-- +goose StatementBegin
CREATE TYPE OperationStatus as ENUM('in_progress', 'succeeded', 'failed');

CREATE TABLE operations(
  id SERIAL PRIMARY KEY,
  cid VARCHAR(255) UNIQUE NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  method VARCHAR(255) NOT NULL,
  status OperationStatus NOT NULL,
  arguments JSONB NOT NULL
);

CREATE INDEX operations_status_idx ON operations(status);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE operations;
DROP TYPE OperationStatus;
-- +goose StatementEnd
