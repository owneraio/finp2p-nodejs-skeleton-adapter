import {
  Keyring, ENV_KEYS, encrypt, decrypt, parse, isEncrypted, EncryptedColumns,
} from '../../src/storage/encryption';

const K1 = Keyring.generateKey();
const K2 = Keyring.generateKey();
const AAD = 't.c';

describe('Keyring', () => {
  test('fromEnv: missing variable names it', () => {
    expect(() => Keyring.fromEnv({})).toThrow(ENV_KEYS);
  });

  test('fromEnv: first key is current, all keys are known', () => {
    const ring = Keyring.fromEnv({ [ENV_KEYS]: `${K2}, ${K1}` });
    expect(ring.all()).toHaveLength(2);
    expect(ring.current.kid).toBe(new Keyring([Buffer.from(K2, 'base64')]).current.kid);
    expect(ring.find(new Keyring([Buffer.from(K1, 'base64')]).current.kid)).toBeDefined();
  });

  test('accepts hex, rejects wrong length and duplicates', () => {
    const hex = Buffer.from(K1, 'base64').toString('hex');
    expect(Keyring.fromEnv({ [ENV_KEYS]: hex }).current.kid).toBe(Keyring.fromEnv({ [ENV_KEYS]: K1 }).current.kid);
    expect(() => Keyring.fromEnv({ [ENV_KEYS]: 'c2hvcnQ=' })).toThrow(/32 bytes/);
    expect(() => Keyring.fromEnv({ [ENV_KEYS]: `${K1},${K1}` })).toThrow(/duplicate/);
  });

  test('salt separates deployments sharing a master key', () => {
    const a = new Keyring([Buffer.from(K1, 'base64')], 'schema_a');
    const b = new Keyring([Buffer.from(K1, 'base64')], 'schema_b');
    expect(encrypt(a, 'deterministic', 'x', AAD)).not.toBe(encrypt(b, 'deterministic', 'x', AAD));
    expect(() => decrypt(b, encrypt(a, 'random', 'x', AAD), AAD)).toThrow();
  });
});

describe('cipher', () => {
  const ring = Keyring.fromEnv({ [ENV_KEYS]: K1 });

  test('random: round-trips, never repeats', () => {
    const a = encrypt(ring, 'random', 'secret', AAD);
    const b = encrypt(ring, 'random', 'secret', AAD);
    expect(a).not.toBe(b);
    expect(decrypt(ring, a, AAD)).toBe('secret');
    expect(decrypt(ring, b, AAD)).toBe('secret');
  });

  test('deterministic: round-trips, repeats, differs per aad', () => {
    const a = encrypt(ring, 'deterministic', 'secret', AAD);
    expect(encrypt(ring, 'deterministic', 'secret', AAD)).toBe(a);
    expect(encrypt(ring, 'deterministic', 'secret', 'other.col')).not.toBe(a);
    expect(decrypt(ring, a, AAD)).toBe('secret');
  });

  test('format: v1.<mode>.<kid>.<body>', () => {
    const stored = encrypt(ring, 'deterministic', '', AAD);
    const parsed = parse(stored);
    expect(parsed).toMatchObject({ version: 'v1', mode: 'deterministic', kid: ring.current.kid });
    expect(isEncrypted(stored)).toBe(true);
    expect(isEncrypted('plain legacy value')).toBe(false);
    expect(decrypt(ring, stored, AAD)).toBe('');
  });

  test('wrong key, bit flip, column swap all fail closed', () => {
    const stored = encrypt(ring, 'random', 'secret', AAD);
    expect(() => decrypt(Keyring.fromEnv({ [ENV_KEYS]: K2 }), stored, AAD)).toThrow(/no key in keyring/);
    const flipped = stored.slice(0, -1) + (stored.endsWith('A') ? 'B' : 'A');
    expect(() => decrypt(ring, flipped, AAD)).toThrow();
    expect(() => decrypt(ring, stored, 'other.col')).toThrow();
  });

  test('rotation: old ciphertext opens while the old key stays in the ring', () => {
    const old = encrypt(ring, 'random', 'secret', AAD);
    const rotated = Keyring.fromEnv({ [ENV_KEYS]: `${K2},${K1}` });
    expect(decrypt(rotated, old, AAD)).toBe('secret');
    expect(parse(encrypt(rotated, 'random', 'secret', AAD))?.kid).toBe(rotated.current.kid);
    expect(() => decrypt(Keyring.fromEnv({ [ENV_KEYS]: K2 }), old, AAD)).toThrow(ring.current.kid);
  });
});

describe('EncryptedColumns', () => {
  interface Row extends Record<string, unknown> {
    id: string;
    det: string | null;
    rnd: string | null;
  }
  const ring = Keyring.fromEnv({ [ENV_KEYS]: K1 });
  const cols = new EncryptedColumns<Row>(ring, 'tbl', {
    det: { mode: 'deterministic' },
    rnd: { mode: 'random' },
  });

  test('toDb / fromDb round-trip', () => {
    const row: Row = { id: '1', det: 'a', rnd: 'b' };
    const db = cols.toDb(row);
    expect(db.id).toBe('1');
    expect(isEncrypted(db.det as string)).toBe(true);
    expect(isEncrypted(db.rnd as string)).toBe(true);
    expect(cols.fromDb(db)).toEqual(row);
  });

  test('null passes through', () => {
    const db = cols.toDb({ id: '1', det: null, rnd: null });
    expect(db).toEqual({ id: '1', det: null, rnd: null });
    expect(cols.fromDb(db)).toEqual({ id: '1', det: null, rnd: null });
  });

  test('non-string values are rejected', () => {
    expect(() => cols.toDb({ id: '1', det: 5 as unknown as string, rnd: null })).toThrow(/strings/);
  });

  test('where: deterministic columns only, one candidate per key', () => {
    expect(cols.where('det', 'a')).toEqual({ column: 'det', values: [encrypt(ring, 'deterministic', 'a', 'tbl.det')] });
    expect(() => cols.where('rnd', 'b')).toThrow(/cannot be queried/);
    expect(() => cols.where('id', 'x')).toThrow(/not an encrypted column/);

    const rotated = new EncryptedColumns<Row>(Keyring.fromEnv({ [ENV_KEYS]: `${K2},${K1}` }), 'tbl', { det: { mode: 'deterministic' } });
    expect(rotated.where('det', 'a').values).toHaveLength(2);
    expect(rotated.where('det', 'a').values[1]).toBe(cols.where('det', 'a').values[0]);
  });

  test('staleColumns names columns not on the current key', () => {
    const db = cols.toDb({ id: '1', det: 'a', rnd: 'b' });
    expect(cols.staleColumns(db)).toEqual([]);
    const rotated = new EncryptedColumns<Row>(Keyring.fromEnv({ [ENV_KEYS]: `${K2},${K1}` }), 'tbl', {
      det: { mode: 'deterministic' }, rnd: { mode: 'random' },
    });
    expect(rotated.staleColumns(db)).toEqual(['det', 'rnd']);
    expect(rotated.staleColumns(rotated.toDb(rotated.fromDb(db)))).toEqual([]);
  });

  test('rejects column names that cannot be spliced into SQL', () => {
    expect(() => new EncryptedColumns(ring, 'tbl', { 'bad col': { mode: 'deterministic' } })).toThrow(/identifier/);
    expect(() => new EncryptedColumns(ring, 'tbl', { 'x;drop': { mode: 'random' } })).toThrow(/identifier/);
  });
});
