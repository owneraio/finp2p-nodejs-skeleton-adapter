import { Pool } from 'pg';
import { migrateIfNeeded } from '../../src/workflows';
import { ConfigStore, KeyStore, SaveConfigInput } from '../../src/config/interfaces';
import { MemoryConfigStore, PgConfigStore } from '../../src/config/store';
import {
  ConfigKind, ERROR_CODES, SEAL_ALG, SealedValue,
} from '../../src/config/types';

const SCHEMA = 'cfg_test';

const sealed = (tag: string): SealedValue => ({
  enc: SEAL_ALG,
  kid: 'kid-1',
  wrappedKey: Buffer.from(`wrapped-${tag}`).toString('base64'),
  iv: Buffer.from('123456789012').toString('base64'),
  ciphertext: Buffer.from(`cipher-${tag}`).toString('base64'),
});

const cfg = (id: string, over: Partial<SaveConfigInput> = {}): SaveConfigInput => ({
  kind: 'network',
  id,
  name: `name-${id}`,
  isDefault: false,
  values: { RPC_URL: `https://${id}.example` },
  secrets: { PRIVATE_KEY: sealed(id) },
  actor: 'tester',
  ...over,
});

const net = (id: string) => ({ kind: 'network' as ConfigKind, id });
const custody = (id: string) => ({ kind: 'custody' as ConfigKind, id });

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

// Same behavioural cases for every ConfigStore + KeyStore implementation.
function configStoreSuite(make: () => ConfigStore & KeyStore) {
  let store: ConfigStore & KeyStore;

  beforeEach(() => {
    store = make();
  });

  test('save inserts version 1 and get returns it', async () => {
    expect(await store.save(cfg('eip155:1'))).toBe(1);
    const got = await store.get(net('eip155:1'));
    expect(got).toMatchObject({
      kind: 'network', id: 'eip155:1', name: 'name-eip155:1', isDefault: false, version: 1, actor: 'tester',
      values: { RPC_URL: 'https://eip155:1.example' },
      secrets: { PRIVATE_KEY: sealed('eip155:1') },
    });
  });

  test('second save bumps the version and replaces values and secrets', async () => {
    await store.save(cfg('a'));
    expect(await store.save(cfg('a', {
      name: 'renamed',
      values: { RPC_URL: 'https://new.example', CHAIN_ID: '1' },
      secrets: { PRIVATE_KEY: sealed('a2') },
    }))).toBe(2);
    const got = await store.get(net('a'));
    expect(got?.version).toBe(2);
    expect(got?.name).toBe('renamed');
    expect(got?.values).toEqual({ RPC_URL: 'https://new.example', CHAIN_ID: '1' });
    expect(got?.secrets).toEqual({ PRIVATE_KEY: sealed('a2') });
  });

  test('the same id under two kinds is two rows', async () => {
    await store.save(cfg('x'));
    await store.save(cfg('x', { kind: 'custody', values: { VENDOR: 'fireblocks' } }));
    expect((await store.get(net('x')))?.values).toEqual({ RPC_URL: 'https://x.example' });
    expect((await store.get(custody('x')))?.values).toEqual({ VENDOR: 'fireblocks' });
    expect((await store.get(custody('x')))?.version).toBe(1);
    expect((await store.list()).map((c) => `${c.kind}/${c.id}`)).toEqual(['network/x', 'custody/x']);
    await store.remove(custody('x'));
    expect(await store.get(net('x'))).toBeDefined();
  });

  test('get unknown -> undefined; list is ordered by creation', async () => {
    expect(await store.get(net('nope'))).toBeUndefined();
    await store.save(cfg('b'));
    await store.save(cfg('a'));
    await store.save(cfg('b'));
    expect((await store.list()).map((c) => c.id)).toEqual(['b', 'a']);
  });

  test('only one default per kind at a time', async () => {
    await store.save(cfg('a', { isDefault: true }));
    await store.save(cfg('b', { isDefault: true }));
    expect((await store.get(net('a')))?.isDefault).toBe(false);
    expect((await store.get(net('b')))?.isDefault).toBe(true);
    // re-saving the default keeps it the default
    await store.save(cfg('b', { isDefault: true }));
    expect((await store.get(net('b')))?.isDefault).toBe(true);
    // a non-default save does not touch the current default
    await store.save(cfg('c'));
    expect((await store.get(net('b')))?.isDefault).toBe(true);
    // another kind has its own default
    await store.save(cfg('fb', { kind: 'custody', isDefault: true }));
    expect((await store.get(net('b')))?.isDefault).toBe(true);
    expect((await store.get(custody('fb')))?.isDefault).toBe(true);
  });

  test('remove deletes; unknown -> notFound', async () => {
    await store.save(cfg('a'));
    await store.remove(net('a'));
    expect(await store.get(net('a'))).toBeUndefined();
    expect(await codeOf(store.remove(net('a')))).toBe(ERROR_CODES.notFound);
    expect(await codeOf(store.remove(custody('a')))).toBe(ERROR_CODES.notFound);
  });

  test('key store: empty, save, roundtrip, newest wins, upsert by kid', async () => {
    expect(await store.loadKey()).toBeUndefined();
    const k1 = { kid: 'k1', privateKeyPem: '-----PEM k1-----', publicKeySpki: 'spki-k1' };
    await store.saveKey(k1);
    expect(await store.loadKey()).toEqual(k1);
    const k2 = { kid: 'k2', privateKeyPem: '-----PEM k2-----', publicKeySpki: 'spki-k2' };
    await store.saveKey(k2);
    expect(await store.loadKey()).toEqual(k2);
    await store.saveKey({ ...k2, publicKeySpki: 'spki-k2-rotated' });
    expect((await store.loadKey())?.publicKeySpki).toBe('spki-k2-rotated');
  });
}

describe('MemoryConfigStore', () => {
  configStoreSuite(() => new MemoryConfigStore());
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
    await pool.query(`TRUNCATE ${SCHEMA}.adapter_configs, ${SCHEMA}.adapter_keys`);
  });

  afterAll(async () => {
    await pool?.end();
    await container?.cleanup();
  });

  configStoreSuite(() => new PgConfigStore(pool, SCHEMA));

  test('rejects an invalid schema name', () => {
    expect(() => new PgConfigStore(pool, 'bad name; drop')).toThrow(/Invalid Postgres identifier/);
  });

  test('no asset binding table exists any more', async () => {
    const res = await pool.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [SCHEMA],
    );
    const tables = res.rows.map((r) => r.table_name);
    expect(tables).toContain('adapter_configs');
    expect(tables).toContain('adapter_keys');
    expect(tables).not.toContain('asset_configs');
    const cols = await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
      [SCHEMA, 'assets'],
    );
    expect(cols.rows.map((r) => r.column_name)).not.toContain('config_id');
  });

  test('secrets column stores the SealedValue JSON exactly as given', async () => {
    const store = new PgConfigStore(pool, SCHEMA);
    const secrets = { PRIVATE_KEY: sealed('x'), API_KEY: sealed('y') };
    await store.save(cfg('a', { secrets }));
    const res = await pool.query(`SELECT "values", secrets, version FROM ${SCHEMA}.adapter_configs WHERE kind = 'network' AND id = $1`, ['a']);
    expect(res.rows[0].secrets).toEqual(secrets);
    expect(res.rows[0].values).toEqual({ RPC_URL: 'https://a.example' });
    expect(res.rows[0].version).toBe(1);
  });

  test('default flag is enforced per kind by the partial unique index', async () => {
    const store = new PgConfigStore(pool, SCHEMA);
    await store.save(cfg('a', { isDefault: true }));
    await expect(pool.query(
      `INSERT INTO ${SCHEMA}.adapter_configs (kind, id, name, is_default, "values") VALUES ('network', 'b', 'b', TRUE, '{}')`,
    )).rejects.toMatchObject({ code: '23505' });
    await expect(pool.query(
      `INSERT INTO ${SCHEMA}.adapter_configs (kind, id, name, is_default, "values") VALUES ('custody', 'b', 'b', TRUE, '{}')`,
    )).resolves.toBeDefined();
  });

  test('updated_at moves on re-save', async () => {
    const store = new PgConfigStore(pool, SCHEMA);
    await store.save(cfg('a'));
    const first = (await store.get(net('a')))!.updatedAt!;
    await pool.query(`UPDATE ${SCHEMA}.adapter_configs SET updated_at = updated_at - interval '1 hour'`);
    await store.save(cfg('a'));
    expect((await store.get(net('a')))!.updatedAt!.getTime()).toBeGreaterThanOrEqual(first.getTime());
  });
});
