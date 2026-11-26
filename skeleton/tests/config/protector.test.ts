import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { KeyringProtector, KmsApi, KmsProtector, ProtectorChain, protectorFromEnv } from '../../src/config';
import { EncryptedColumns, Keyring } from '../../src/storage/encryption';

/** A KMS in memory: one symmetric key, data keys wrapped under it with the encryption context bound in. */
function fakeKms() {
  const master = randomBytes(32);
  const calls: string[] = [];
  const ctx = (c: Record<string, string>) => Buffer.from(JSON.stringify(c));
  const api: KmsApi = {
    async generateDataKey({ KeyId, EncryptionContext }) {
      calls.push(`generate ${KeyId}`);
      const plain = randomBytes(32);
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', master, iv);
      c.setAAD(ctx(EncryptionContext));
      return { Plaintext: Buffer.from(plain), CiphertextBlob: Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]) };
    },
    async decrypt({ CiphertextBlob, EncryptionContext }) {
      calls.push('decrypt');
      const blob = Buffer.from(CiphertextBlob);
      const d = createDecipheriv('aes-256-gcm', master, blob.subarray(0, 12));
      d.setAAD(ctx(EncryptionContext));
      d.setAuthTag(blob.subarray(blob.length - 16));
      try {
        return { Plaintext: Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]) };
      } catch {
        throw Object.assign(new Error('the request carried secret-looking details'), { name: 'InvalidCiphertextException' });
      }
    },
  };
  return { api, calls };
}

const keyring = () => new Keyring([Buffer.alloc(32, 7)]);
const CONTEXT = 'adapter_config_values.value';

describe('the keyring protector', () => {
  it('opens what EncryptedColumns sealed for the same column, and EncryptedColumns opens what it seals', async () => {
    const ring = keyring();
    const protector = new KeyringProtector(ring);
    const columns = new EncryptedColumns<{ field_id: string; value: string }>(ring, 'adapter_config_values', { value: { mode: 'random' } });
    const written = columns.toDb({ field_id: 'a', value: 'secret' }).value as string;
    expect(written).toMatch(/^v1\.r\.[0-9a-f]{8}\./);
    expect(await protector.open(written, CONTEXT)).toBe('secret');
    expect(columns.fromDb({ field_id: 'a', value: await protector.seal('other', CONTEXT) }).value).toBe('other');
  });

  it('fails to open a value moved to another column', async () => {
    const protector = new KeyringProtector(keyring());
    await expect(protector.open(await protector.seal('secret', CONTEXT), 'adapter_config_applied.field_values')).rejects.toThrow(/failed authentication/);
  });
});

describe('the KMS protector', () => {
  it('seals each value under its own data key, never in the clear, and opens it with one decrypt', async () => {
    const { api, calls } = fakeKms();
    const protector = new KmsProtector('alias/adapter-config', api);
    const a = await protector.seal('secret', CONTEXT);
    const b = await protector.seal('secret', CONTEXT);
    expect(a).toMatch(/^kms1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
    expect(await protector.open(a, CONTEXT)).toBe('secret');
    expect(calls).toEqual(['generate alias/adapter-config', 'generate alias/adapter-config', 'decrypt']);
  });

  it('fails to open a value moved to another column, naming only the KMS error', async () => {
    const { api } = fakeKms();
    const protector = new KmsProtector('k', api);
    const sealed = await protector.seal('secret', CONTEXT);
    const failure: Error = await protector.open(sealed, 'adapter_config_applied.field_values').then(() => new Error('opened'), (e: Error) => e);
    expect(failure.message).toBe('kms decrypt failed: InvalidCiphertextException');
  });

  it('fails to open a value whose ciphertext was changed', async () => {
    const { api } = fakeKms();
    const protector = new KmsProtector('k', api);
    const sealed = await protector.seal('secret', CONTEXT);
    const [, key, body] = sealed.split('.');
    const bytes = Buffer.from(body, 'base64url');
    bytes[bytes.length - 1] ^= 1;
    await expect(protector.open(`kms1.${key}.${bytes.toString('base64url')}`, CONTEXT)).rejects.toThrow(/failed authentication/);
    await expect(protector.open('v1.r.00000000.abc', CONTEXT)).rejects.toThrow(/not a KMS-sealed value/);
  });
});

describe('the protector the deployment configured', () => {
  it('seals with KMS when a KMS key is set, and still opens what the keyring sealed before', async () => {
    const before = new KeyringProtector(keyring());
    const old = await before.seal('from-the-keyring', CONTEXT);
    const { api } = fakeKms();
    const protector = await protectorFromEnv({ CONFIG_KMS_KEY_ID: 'alias/adapter-config', DB_ENCRYPTION_KEY_CURRENT: Buffer.alloc(32, 7).toString('base64') }, api);
    expect(protector.name).toBe('kms');
    expect(await protector.seal('new', CONTEXT)).toMatch(/^kms1\./);
    expect(await protector.open(old, CONTEXT)).toBe('from-the-keyring');
  });

  it('seals with KMS alone when no keyring is set, and cannot open a keyring value then', async () => {
    const { api } = fakeKms();
    const protector = await protectorFromEnv({ CONFIG_KMS_KEY_ID: 'k' }, api);
    expect(protector).toBeInstanceOf(KmsProtector);
    await expect(new ProtectorChain(protector).open('v1.r.0a0b0c0d.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', CONTEXT)).rejects.toThrow(/no configured protector reads this value \(sealed with v1\)/);
  });

  it('seals with the keyring when no KMS key is set', async () => {
    const protector = await protectorFromEnv({ DB_ENCRYPTION_KEY_CURRENT: Keyring.generateKey() });
    expect(protector).toBeInstanceOf(KeyringProtector);
  });

  it('refuses to store anything when neither is set', async () => {
    await expect(protectorFromEnv({})).rejects.toThrow(/neither CONFIG_KMS_KEY_ID nor DB_ENCRYPTION_KEY_CURRENT is set/);
  });

  it('says to install the SDK when a KMS key is set without it', async () => {
    await expect(protectorFromEnv({ CONFIG_KMS_KEY_ID: 'k' })).rejects.toThrow(/@aws-sdk\/client-kms is not installed/);
  });
});
