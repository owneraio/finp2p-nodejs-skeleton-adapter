import { Pool } from 'pg';
import { Keyring, EncryptedColumns, ENV_KEYS } from '../../src/storage/encryption';

// Stand-in for the planned per-asset config store. Table created here, not by a migration.

interface AssetConfig extends Record<string, unknown> {
  asset_id: string;
  contract_address: string; // deterministic, UNIQUE
  custodian_account: string; // deterministic, indexed
  signing_key: string | null; // random
}

const SCHEMA = 'ledger_adapter';
const TABLE = 'poc_asset_configs';
const FQ = `${SCHEMA}.${TABLE}`;
const DDL = `
  CREATE SCHEMA ${SCHEMA};
  CREATE TABLE ${FQ} (
    asset_id          TEXT PRIMARY KEY,
    contract_address  TEXT NOT NULL UNIQUE,
    custodian_account TEXT NOT NULL,
    signing_key       TEXT
  );
  CREATE INDEX ON ${FQ} (custodian_account);`;

const K1 = Keyring.generateKey();
const K2 = Keyring.generateKey();
const ring = (...keys: string[]) => Keyring.fromEnv({ [ENV_KEYS]: keys.join(',') });

/** Adapter store with the brick plugged in. */
class PocStore {
  readonly cols: EncryptedColumns<AssetConfig>;

  constructor(private pool: Pool, keyring: Keyring) {
    this.cols = new EncryptedColumns<AssetConfig>(keyring, TABLE, {
      contract_address: { mode: 'deterministic' },
      custodian_account: { mode: 'deterministic' },
      signing_key: { mode: 'random' },
    });
  }

  async insert(row: AssetConfig): Promise<void> {
    const db = this.cols.toDb(row);
    await this.pool.query(
      `INSERT INTO ${FQ} (asset_id, contract_address, custodian_account, signing_key) VALUES ($1, $2, $3, $4)`,
      [db.asset_id, db.contract_address, db.custodian_account, db.signing_key],
    );
  }

  async get(assetId: string): Promise<AssetConfig | undefined> {
    const { rows } = await this.pool.query(`SELECT * FROM ${FQ} WHERE asset_id = $1`, [assetId]);
    return rows.length ? this.cols.fromDb(rows[0]) : undefined;
  }

  private async findBy(column: keyof AssetConfig & string, value: string): Promise<AssetConfig[]> {
    const lookup = this.cols.where(column, value);
    const { rows } = await this.pool.query(`SELECT * FROM ${FQ} WHERE ${lookup.column} = ANY($1) ORDER BY asset_id`, [lookup.values]);
    return rows.map((r) => this.cols.fromDb(r));
  }

  findByContract(address: string) { return this.findBy('contract_address', address); }

  findByCustodian(account: string) { return this.findBy('custodian_account', account); }

  /** Rewrite rows not on the current key; returns the count. */
  async rotate(): Promise<number> {
    const { rows } = await this.pool.query(`SELECT * FROM ${FQ}`);
    let n = 0;
    for (const raw of rows) {
      if (this.cols.staleColumns(raw).length === 0) continue;
      const db = this.cols.toDb(this.cols.fromDb(raw));
      await this.pool.query(
        `UPDATE ${FQ} SET contract_address = $2, custodian_account = $3, signing_key = $4 WHERE asset_id = $1`,
        [db.asset_id, db.contract_address, db.custodian_account, db.signing_key],
      );
      n += 1;
    }
    return n;
  }
}

describe('encryption at rest (postgres)', () => {
  let container: { connectionString: string; storageUser: string; cleanup: () => Promise<void> };
  let pool: Pool;
  let store: PocStore;

  const row = (assetId: string, extra: Partial<AssetConfig> = {}): AssetConfig => ({
    asset_id: assetId,
    contract_address: `0xC0${assetId}`,
    custodian_account: `Acct-${assetId}`,
    signing_key: `0xKEY${assetId}`,
    ...extra,
  });

  beforeAll(async () => {
    // @ts-ignore
    container = await global.startPostgresContainer();
    pool = new Pool({ connectionString: container.connectionString });
    await pool.query(DDL);
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE ${FQ}`);
    store = new PocStore(pool, ring(K1));
  });

  afterAll(async () => {
    await pool.end();
    await container.cleanup();
  });

  const rawRow = async (assetId: string) => (await pool.query(`SELECT * FROM ${FQ} WHERE asset_id = $1`, [assetId])).rows[0];

  test('the database holds ciphertext only; the store returns plaintext', async () => {
    const plain = row('a1', { contract_address: '0xContractAddressA1', custodian_account: 'CustodianAccountA1', signing_key: 'SigningKeyA1' });
    await store.insert(plain);
    const raw = await rawRow('a1');
    for (const col of ['contract_address', 'custodian_account', 'signing_key'] as const) {
      expect(raw[col]).toMatch(/^v1\.[rd]\.[0-9a-f]{8}\./);
      expect(raw[col]).not.toContain(plain[col]);
    }
    expect(await store.get('a1')).toEqual(plain);
  });

  test('random columns never repeat; deterministic columns repeat', async () => {
    await store.insert(row('a1', { custodian_account: 'shared', signing_key: 'same' }));
    await store.insert(row('a2', { custodian_account: 'shared', signing_key: 'same' }));
    await store.insert(row('a3', { custodian_account: 'other', signing_key: null }));
    const [r1, r2, r3] = [await rawRow('a1'), await rawRow('a2'), await rawRow('a3')];
    expect(r1.signing_key).not.toBe(r2.signing_key);
    expect(r1.custodian_account).toBe(r2.custodian_account);
    expect(r3.custodian_account).not.toBe(r1.custodian_account);
    expect(r3.signing_key).toBeNull();
    expect((await store.findByCustodian('shared')).map((r) => r.asset_id)).toEqual(['a1', 'a2']);
  });

  test('deterministic column: equality lookup through the index and UNIQUE enforced by Postgres', async () => {
    await store.insert(row('a1'));
    await store.insert(row('a2'));
    expect((await store.findByContract('0xC0a2')).map((r) => r.asset_id)).toEqual(['a2']);
    expect(await store.findByContract('0xNOPE')).toEqual([]);
    await expect(store.insert(row('a3', { contract_address: '0xC0a1' }))).rejects.toMatchObject({ code: '23505' });
    // byte-exact equality, no case folding
    await expect(store.insert(row('a3', { contract_address: '0xc0A1' }))).resolves.toBeUndefined();
    expect(await store.findByContract('0xc0a1')).toEqual([]);
  });

  test('key rotation: read and look up through the old key, rewrite, then retire it', async () => {
    await store.insert(row('a1'));
    const rotated = new PocStore(pool, ring(K2, K1));
    expect(await rotated.get('a1')).toEqual(row('a1'));
    expect((await rotated.findByContract('0xC0a1')).map((r) => r.asset_id)).toEqual(['a1']);
    await rotated.insert(row('a2'));

    const retiredTooEarly = new PocStore(pool, ring(K2));
    await expect(retiredTooEarly.get('a1')).rejects.toThrow(/no key in keyring/);

    expect(await rotated.rotate()).toBe(1);
    expect(await rotated.rotate()).toBe(0);
    expect(await retiredTooEarly.get('a1')).toEqual(row('a1'));
    expect((await retiredTooEarly.findByContract('0xC0a1')).map((r) => r.asset_id)).toEqual(['a1']);
  });

  test('a wrong key or a ciphertext moved between columns fails closed', async () => {
    await store.insert(row('a1'));
    await expect(new PocStore(pool, ring(Keyring.generateKey())).get('a1')).rejects.toThrow(/no key in keyring/);
    await pool.query(`UPDATE ${FQ} SET signing_key = custodian_account WHERE asset_id = $1`, ['a1']);
    await expect(store.get('a1')).rejects.toThrow(/signing_key: ciphertext failed authentication/);
  });
});
