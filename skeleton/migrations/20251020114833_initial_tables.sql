-- +goose Up
-- +goose StatementBegin
CREATE TYPE InstructionStatus as ENUM('in_progress', 'succeeded', 'failed');

CREATE TABLE instructions(
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  method VARCHAR(255) NOT NULL,
  status InstructionStatus NOT NULL,
  arguments JSONB NOT NULL
);

CREATE INDEX instructions_status_idx ON instructions(status);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE instructions;
DROP TYPE InstructionStatus;
-- +goose StatementEnd
