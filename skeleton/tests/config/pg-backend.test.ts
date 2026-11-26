import { Pool } from 'pg';
import { KeyringProtector, PgConfigBackend } from '../../src/config';
import { EncryptedColumns, Keyring, isEncrypted } from '../../src/storage/encryption';
import { migrateIfNeeded } from '../../src/workflows';

const SCHEMA = 'ledger_adapter';

/** The tables as GCA and Canton created them under their own migration history, before the skeleton had them. */
const ADAPTER_OWN_DDL = `
  CREATE SCHEMA ${SCHEMA};
  CREATE TABLE ${SCHEMA}.adapter_config_values(field_id VARCHAR(255) PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE ${SCHEMA}.adapter_config_applied(id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1), version INTEGER NOT NULL, applied_at TIMESTAMPTZ NOT NULL, field_values TEXT NOT NULL);`;

describe('the configuration in Postgres', () => {
  let container: { connectionString: string; storageUser: string; cleanup: () => Promise<void> };
  let pool: Pool;

  const migrate = async () => migrateIfNeeded({
    connectionString: container.connectionString,
    // @ts-ignore
    gooseExecutablePath: await global.whichGoose(),
    migrationListTableName: 'finp2p_nodejs_skeleton_migrations',
    storageUser: container.storageUser,
    schemaName: SCHEMA,
  });

  beforeEach(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    pool = new Pool({ connectionString: container.connectionString });
  });

  afterEach(async () => {
    await pool.end();
    await container.cleanup();
  });

  it('keeps values and the applied version sealed, the applied one only, and refuses a wrong key', async () => {
    await migrate();
    const keyring = new Keyring([Buffer.alloc(32, 3)]);
    const backend = new PgConfigBackend(pool, SCHEMA, keyring);
    await backend.put('ledger.id', 'eip155:1');
    await backend.put('dtcc.password', 'first-secret');
    await backend.put('dtcc.password', 'second-secret');
    expect(await backend.get('dtcc.password')).toBe('second-secret');
    await backend.remove('ledger.id');
    expect(await backend.get('ledger.id')).toBeUndefined();

    await backend.saveApplied({ version: 1, appliedAt: '2026-11-23T10:00:00.000Z' }, { 'dtcc.password': 'first-secret' });
    await backend.saveApplied({ version: 2, appliedAt: '2026-11-23T11:00:00.000Z' }, { 'dtcc.password': 'second-secret' });
    expect(await backend.load()).toEqual({
      values: new Map([['dtcc.password', 'second-secret']]),
      applied: { version: 2, appliedAt: '2026-11-23T11:00:00.000Z', fieldValues: { 'dtcc.password': 'second-secret' } },
    });

    const values = await pool.query(`SELECT value FROM ${SCHEMA}.adapter_config_values`);
    expect(values.rows.every((r) => isEncrypted(r.value) && !String(r.value).includes('secret'))).toBe(true);
    const applied = await pool.query(`SELECT version, field_values FROM ${SCHEMA}.adapter_config_applied`);
    expect(applied.rows).toHaveLength(1);
    expect(applied.rows[0].version).toBe(2);
    expect(isEncrypted(applied.rows[0].field_values)).toBe(true);

    await expect(new PgConfigBackend(pool, SCHEMA, new Keyring([Buffer.alloc(32, 4)])).load()).rejects.toThrow();
  });

  it('migrates over tables an adapter already created, and reads the rows its own copy wrote', async () => {
    await pool.query(ADAPTER_OWN_DDL);
    const keyring = new Keyring([Buffer.alloc(32, 5)]);
    // Written the way GCA's and Canton's copies write today: EncryptedColumns, random mode.
    const values = new EncryptedColumns<{ field_id: string; value: string }>(keyring, 'adapter_config_values', { value: { mode: 'random' } });
    const appliedColumns = new EncryptedColumns<{ field_values: string }>(keyring, 'adapter_config_applied', { field_values: { mode: 'random' } });
    await pool.query(`INSERT INTO ${SCHEMA}.adapter_config_values (field_id, value) VALUES ($1, $2)`, ['dtcc.password', values.toDb({ field_id: 'dtcc.password', value: 'kept' }).value]);
    await pool.query(`INSERT INTO ${SCHEMA}.adapter_config_applied (version, applied_at, field_values) VALUES (3, '2026-11-20T00:00:00Z', $1)`, [appliedColumns.toDb({ field_values: JSON.stringify({ 'dtcc.password': 'kept' }) }).field_values]);

    await migrate();

    const backend = new PgConfigBackend(pool, SCHEMA, new KeyringProtector(keyring));
    expect(await backend.load()).toEqual({
      values: new Map([['dtcc.password', 'kept']]),
      applied: { version: 3, appliedAt: '2026-11-20T00:00:00.000Z', fieldValues: { 'dtcc.password': 'kept' } },
    });
  });
});
