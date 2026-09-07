-- +goose Up
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.assets DROP CONSTRAINT assets_pkey;
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.assets DROP COLUMN type;
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.assets ADD PRIMARY KEY (id);
-- +goose StatementEnd
-- +goose ENVSUB OFF

-- +goose Down
-- +goose ENVSUB ON
-- +goose StatementBegin
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.assets DROP CONSTRAINT assets_pkey;
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.assets ADD COLUMN type VARCHAR(255) NOT NULL DEFAULT 'finp2p';
ALTER TABLE ${LEDGER_SCHEMA?LEDGER_SCHEMA env var is required}.assets ADD PRIMARY KEY (type, id);
-- +goose StatementEnd
-- +goose ENVSUB OFF
