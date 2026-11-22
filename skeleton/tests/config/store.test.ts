import { Pool } from 'pg';
import { migrateIfNeeded } from '../../src/workflows';
import { ConfigStore, KeyStore, SaveConfigInput } from '../../src/config/interfaces';
import { MemoryConfigStore, PgConfigStore } from '../../src/config/store';
import { SEAL_ALG, SealedValue } from '../../src/config/types';

const SCHEMA = 'cfg_test';

const sealed = (tag: string): SealedValue => ({
  enc: SEAL_ALG,
  kid: 'kid-1',
  wrappedKey: Buffer.from(`wrapped-${tag}`).toString('base64'),
  iv: Buffer.from('123456789012').toString('base64'),
  ciphertext: Buffer.from(`cipher-${tag}`).toString('base64'),
});

const doc = (over: Partial<SaveConfigInput> = {}): SaveConfigInput => ({
  version: 'test-config/1',
  ledgers: { 'eip155:1': { rpcUrl: 'https://rpc.example', chainId: 1, operatorKey: sealed('a') } },
  custody: { provider: 'kms' },
  actor: 'tester',
  ...over,
});

// Same behavioural cases for every ConfigStore + KeyStore implementation.
function configStoreSuite(make: () => ConfigStore & KeyStore) {
  let store: ConfigStore & KeyStore;

  beforeEach(() => {
    store = make();
  });

  test('load is undefined before the first save', async () => {
    expect(await store.load()).toBeUndefined();
  });

  test('save writes revision 1 and load returns the document', async () => {
    expect(await store.save(doc())).toBe(1);
    expect(await store.load()).toMatchObject({ ...doc(), revision: 1 });
  });

  test('a second save replaces the document and bumps the revision', async () => {
    await store.save(doc());
    expect(await store.save(doc({ version: 'test-config/2', ledgers: { 'eip155:5': { rpcUrl: 'https://b.example' } }, custody: undefined, actor: undefined }))).toBe(2);
    const got = await store.load();
    expect(got).toMatchObject({ version: 'test-config/2', revision: 2, ledgers: { 'eip155:5': { rpcUrl: 'https://b.example' } } });
    expect(got?.custody).toBeUndefined();
    expect(got?.actor).toBeUndefined();
  });

  test('the key store keeps the latest key pair', async () => {
    expect(await store.loadKey()).toBeUndefined();
    await store.saveKey({ kid: 'local:1', privateKeyPem: 'pem-1', publicKeySpki: 'spki-1' });
    expect(await store.loadKey()).toEqual({ kid: 'local:1', privateKeyPem: 'pem-1', publicKeySpki: 'spki-1' });
  });
}

describe('MemoryConfigStore', () => {
  configStoreSuite(() => new MemoryConfigStore());

  test('load returns a copy', async () => {
    const store = new MemoryConfigStore();
    await store.save(doc());
    const a = await store.load();
    a!.ledgers['eip155:1'].rpcUrl = 'changed';
    expect((await store.load())?.ledgers['eip155:1'].rpcUrl).toBe('https://rpc.example');
  });
});

describe('PgConfigStore', () => {
  let container: { connectionString: string; storageUser: string; cleanup: () => Promise<void> };
  let pool: Pool;

  beforeAll(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    await migrateIfNeeded({
      connectionString: container.connectionString,
      // @ts-ignore
      gooseExecutablePath: await global.whichGoose(),
      migrationListTableName: 'finp2p_nodejs_skeleton_migrations',
      storageUser: container.storageUser,
      schemaName: SCHEMA,
    });
    pool = new Pool({ connectionString: container.connectionString });
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${SCHEMA}.adapter_config, ${SCHEMA}.adapter_keys`);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.cleanup();
  });

  configStoreSuite(() => new PgConfigStore(pool, SCHEMA));

  test('rejects an invalid schema name', () => {
    expect(() => new PgConfigStore(pool, 'bad name; drop')).toThrow(/Invalid Postgres identifier/);
  });

  test('1 document table, no per-kind table', async () => {
    const res = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [SCHEMA],
    );
    const tables = res.rows.map((r) => r.table_name);
    expect(tables).toContain('adapter_config');
    expect(tables).toContain('adapter_keys');
    expect(tables).not.toContain('adapter_configs');
    await expect(pool.query(`INSERT INTO ${SCHEMA}.adapter_config (id, version, revision, config) VALUES ('second', 'v', 1, '{}')`))
      .rejects.toThrow(/check constraint/);
  });
});
