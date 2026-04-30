-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets DROP CONSTRAINT assets_pkey;
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets DROP COLUMN type;
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets ADD PRIMARY KEY (id);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets DROP CONSTRAINT assets_pkey;
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets ADD COLUMN type VARCHAR(255) NOT NULL DEFAULT 'finp2p';
ALTER TABLE ${LEDGER_SCHEMA:-ledger_adapter}.assets ADD PRIMARY KEY (type, id);
-- +goose StatementEnd
-- +goose ENVSUB OFF
