-- +goose Up
-- +goose StatementBegin
ALTER TABLE ledger_adapter.assets DROP CONSTRAINT assets_pkey;
ALTER TABLE ledger_adapter.assets DROP COLUMN type;
ALTER TABLE ledger_adapter.assets ADD PRIMARY KEY (id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE ledger_adapter.assets DROP CONSTRAINT assets_pkey;
ALTER TABLE ledger_adapter.assets ADD COLUMN type VARCHAR(255) NOT NULL DEFAULT 'finp2p';
ALTER TABLE ledger_adapter.assets ADD PRIMARY KEY (type, id);
-- +goose StatementEnd
