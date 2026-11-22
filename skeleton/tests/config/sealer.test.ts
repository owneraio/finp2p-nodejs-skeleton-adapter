import { createPublicKey } from 'node:crypto';
import { SEAL_ALG, SealedValue } from '../../src/config/types';
import { KeyStore, Sealer } from '../../src/config/interfaces';
import { openSealed, sealWithPublicKey } from '../../src/config/envelope';
import { KmsSealer, LocalRsaSealer, sealerFromEnv } from '../../src/config/sealer';

// in-memory KeyStore
class FakeKeyStore implements KeyStore {
  stored: { kid: string; privateKeyPem: string; publicKeySpki: string } | undefined;

  saves = 0;

  async loadKey() { return this.stored; }

  async saveKey(key: { kid: string; privateKeyPem: string; publicKeySpki: string }) {
    this.stored = key;
    this.saves += 1;
  }
}

const PEM_LIKE = `-----BEGIN PRIVATE KEY-----\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n'.repeat(60)}-----END PRIVATE KEY-----\n`;
const UTF8 = 'pässwörd ∑ 日本語 🔑';

const MINISTACK = 'http://localhost:4566';
const KMS_ALIAS = 'alias/adapter-config';
const KMS_OPTS = {
  keyId: KMS_ALIAS,
  region: 'us-east-1',
  endpoint: MINISTACK,
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
};

// @types/node 16 has no fetch typing; node 26 has it at runtime
type Fetch = (url: string, init?: { signal?: unknown }) => Promise<{ ok: boolean }>;
const { fetch, AbortSignal } = globalThis as unknown as { fetch: Fetch; AbortSignal: { timeout(ms: number): unknown } };

async function ministackUp(): Promise<boolean> {
  try {
    const res = await fetch(`${MINISTACK}/_ministack/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const expectSealedShape = (s: SealedValue, kid: string) => {
  expect(s.enc).toBe(SEAL_ALG);
  expect(s.kid).toBe(kid);
  expect(Buffer.from(s.iv, 'base64')).toHaveLength(12);
  expect(Buffer.from(s.wrappedKey, 'base64')).toHaveLength(256);   // RSA-2048
};

/** Shared roundtrip + tamper cases, run against both providers. */
function commonSealerTests(getSealer: () => Sealer) {
  test('publicKey is base64 SPKI DER importable with createPublicKey', async () => {
    const key = createPublicKey({ key: Buffer.from(await getSealer().publicKey(), 'base64'), format: 'der', type: 'spki' });
    expect(key.asymmetricKeyType).toBe('rsa');
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  test.each([
    ['short', 'hunter2'],
    ['3 KB pem-like', PEM_LIKE],
    ['utf-8', UTF8],
    ['empty', ''],
  ])('seal -> open roundtrip (%s)', async (_label, plain) => {
    const sealer = getSealer();
    const sealed = sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), plain);
    expectSealedShape(sealed, await sealer.kid());
    // an empty plaintext has no prefix to look for (the old fallback 'x' made the test fail on ~29% of runs)
    const prefix = Buffer.from(plain).toString('base64').slice(0, 8);
    if (prefix) expect(sealed.ciphertext).not.toContain(prefix);
    await expect(openSealed(sealer, sealed)).resolves.toBe(plain);
  });

  test('wrong kid is rejected', async () => {
    const sealer = getSealer();
    const sealed = sealWithPublicKey(await sealer.publicKey(), 'local:0000000000000000', 'x');
    await expect(openSealed(sealer, sealed)).rejects.toThrow('unknown kid');
  });

  test('tampered ciphertext is rejected by the auth tag', async () => {
    const sealer = getSealer();
    const sealed = sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), 'do not touch');
    const body = Buffer.from(sealed.ciphertext, 'base64');
    body[0] ^= 0x01;
    await expect(openSealed(sealer, { ...sealed, ciphertext: body.toString('base64') })).rejects.toThrow();
    const tag = Buffer.from(sealed.ciphertext, 'base64');
    tag[tag.length - 1] ^= 0x01;
    await expect(openSealed(sealer, { ...sealed, ciphertext: tag.toString('base64') })).rejects.toThrow();
  });

  test('tampered wrapped key is rejected without echoing the data', async () => {
    const sealer = getSealer();
    const sealed = sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), 'x');
    const wk = Buffer.from(sealed.wrappedKey, 'base64');
    wk[10] ^= 0xff;
    const err = await openSealed(sealer, { ...sealed, wrappedKey: wk.toString('base64') }).catch((e: Error) => e) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain(sealed.wrappedKey.slice(0, 12));
  });

}

describe('LocalRsaSealer', () => {
  let sealer: LocalRsaSealer;

  beforeAll(async () => {
    sealer = await LocalRsaSealer.create();
  });

  test('provider and kid shape', async () => {
    expect(sealer.provider).toBe('local');
    expect(await sealer.kid()).toMatch(/^local:[0-9a-f]{16}$/);
  });

  commonSealerTests(() => sealer);

  test('two in-memory sealers have different kids and cannot open each other\'s values', async () => {
    const other = await LocalRsaSealer.create();
    expect(await other.kid()).not.toBe(await sealer.kid());
    const sealed = sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), 'x');
    await expect(openSealed(other, sealed)).rejects.toThrow('unknown kid');
  });

  test('key persisted through a KeyStore is reloaded with the same kid and opens old values', async () => {
    const store = new FakeKeyStore();
    const first = await LocalRsaSealer.create(store);
    expect(store.saves).toBe(1);
    expect(store.stored?.kid).toBe(await first.kid());
    expect(store.stored?.publicKeySpki).toBe(await first.publicKey());
    expect(store.stored?.privateKeyPem).toMatch(/^-----BEGIN PRIVATE KEY-----/);

    const sealed = sealWithPublicKey(await first.publicKey(), await first.kid(), PEM_LIKE);

    const second = await LocalRsaSealer.create(store);
    expect(store.saves).toBe(1);   // loaded, not regenerated
    expect(await second.kid()).toBe(await first.kid());
    expect(await second.publicKey()).toBe(await first.publicKey());
    await expect(openSealed(second, sealed)).resolves.toBe(PEM_LIKE);
  });

  test('sealerFromEnv without KMS_KEY_ID gives a local sealer backed by the key store', async () => {
    const store = new FakeKeyStore();
    const s = await sealerFromEnv({}, store);
    expect(s.provider).toBe('local');
    expect(store.stored?.kid).toBe(await s.kid());
  });

  test('sealerFromEnv with KMS_KEY_ID gives a kms sealer (no network call yet)', async () => {
    const s = await sealerFromEnv({ KMS_KEY_ID: 'alias/x', AWS_REGION: 'eu-west-1', AWS_ENDPOINT_URL: 'http://127.0.0.1:1' });
    expect(s.provider).toBe('kms');
    expect(s).toBeInstanceOf(KmsSealer);
  });
});

describe('KmsSealer (ministack)', () => {
  let up = false;
  let sealer: KmsSealer;

  beforeAll(async () => {
    up = await ministackUp();
    if (!up) {
      console.log(`KmsSealer tests skipped: ${MINISTACK}/_ministack/health not reachable`);
      return;
    }
    sealer = new KmsSealer(KMS_OPTS);
  });

  const when = (name: string, fn: () => Promise<void>) => test(name, async () => {
    if (!up) return;
    await fn();
  });

  when('provider and kid is the key ARN', async () => {
    expect(sealer.provider).toBe('kms');
    expect(await sealer.kid()).toMatch(/^arn:aws:kms:us-east-1:\d{12}:key\/[0-9a-f-]{36}$/);
  });

  when('publicKey is base64 SPKI DER importable with createPublicKey', async () => {
    const key = createPublicKey({ key: Buffer.from(await sealer.publicKey(), 'base64'), format: 'der', type: 'spki' });
    expect(key.asymmetricKeyType).toBe('rsa');
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  when('public key is fetched once and cached', async () => {
    const client = { send: jest.fn() };
    const { KMSClient } = await import('@aws-sdk/client-kms');
    const real = new KMSClient({ region: KMS_OPTS.region, endpoint: KMS_OPTS.endpoint, credentials: KMS_OPTS.credentials });
    client.send.mockImplementation((cmd) => real.send(cmd));
    const s = new KmsSealer({ keyId: KMS_ALIAS, client: client as unknown as import('@aws-sdk/client-kms').KMSClient });
    await s.publicKey();
    await s.kid();
    await s.publicKey();
    expect(client.send).toHaveBeenCalledTimes(1);
    real.destroy();
  });

  when('seal (node) -> KMS decrypt roundtrip', async () => {
    for (const plain of ['hunter2', PEM_LIKE, UTF8]) {
      const sealed = sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), plain);
      expectSealedShape(sealed, await sealer.kid());
      // eslint-disable-next-line no-await-in-loop
      await expect(openSealed(sealer, sealed)).resolves.toBe(plain);
    }
  });

  when('bare keyId used as kid is accepted too', async () => {
    const sealed = sealWithPublicKey(await sealer.publicKey(), KMS_ALIAS, 'x');
    await expect(openSealed(sealer, sealed)).resolves.toBe('x');
  });

  when('a kid that is not a KMS key ARN is rejected before calling KMS', async () => {
    const sealed = sealWithPublicKey(await sealer.publicKey(), 'alias/other', 'x');
    await expect(openSealed(sealer, sealed)).rejects.toThrow('unknown kid');
  });

  when('a KMS key ARN that does not exist fails in KMS, not before', async () => {
    const sealed = sealWithPublicKey(await sealer.publicKey(), 'arn:aws:kms:us-east-1:000000000000:key/nope', 'x');
    await expect(openSealed(sealer, sealed)).rejects.toThrow(/^kms decrypt failed: /);
  });

  when('an envelope sealed under a previous key still opens after the key was rotated', async () => {
    const { KMSClient, CreateKeyCommand, ScheduleKeyDeletionCommand } = await import('@aws-sdk/client-kms');
    const client = new KMSClient({ region: KMS_OPTS.region, endpoint: KMS_OPTS.endpoint, credentials: KMS_OPTS.credentials });
    const newKey = async () => {
      const out = await client.send(new CreateKeyCommand({ KeySpec: 'RSA_2048', KeyUsage: 'ENCRYPT_DECRYPT' }));
      return out.KeyMetadata!.Arn!;
    };
    const arnA = await newKey();
    const arnB = await newKey();
    try {
      const a = new KmsSealer({ ...KMS_OPTS, keyId: arnA });
      const b = new KmsSealer({ ...KMS_OPTS, keyId: arnB });
      const sealed = sealWithPublicKey(await a.publicKey(), await a.kid(), PEM_LIKE);
      expect(sealed.kid).toBe(arnA);
      // "rotation": the adapter now runs on key B, rows sealed under A keep A's ARN as kid
      await expect(openSealed(b, sealed)).resolves.toBe(PEM_LIKE);
      // but an envelope that was not wrapped by the named key still fails
      const mismatched = sealWithPublicKey(await b.publicKey(), arnA, 'x');
      await expect(openSealed(b, mismatched)).rejects.toThrow(/^kms decrypt failed: /);
    } finally {
      for (const arn of [arnA, arnB]) {
        // eslint-disable-next-line no-await-in-loop
        await client.send(new ScheduleKeyDeletionCommand({ KeyId: arn, PendingWindowInDays: 7 })).catch(() => undefined);
      }
      client.destroy();
    }
  });

  when('tampered wrapped key -> "kms decrypt failed: <name>" without the ciphertext', async () => {
    const sealed = sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), 'x');
    const wk = Buffer.from(sealed.wrappedKey, 'base64');
    wk[5] ^= 0xff;
    const bad = wk.toString('base64');
    const err = await openSealed(sealer, { ...sealed, wrappedKey: bad }).catch((e: Error) => e) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^kms decrypt failed: \w+$/);
    expect(err.message).not.toContain(bad.slice(0, 12));
  });

  when('tampered ciphertext is rejected by the auth tag', async () => {
    const sealed = sealWithPublicKey(await sealer.publicKey(), await sealer.kid(), 'x');
    const body = Buffer.from(sealed.ciphertext, 'base64');
    body[body.length - 1] ^= 0x01;
    await expect(openSealed(sealer, { ...sealed, ciphertext: body.toString('base64') })).rejects.toThrow();
  });

  when('a non-RSA / missing key gives a clear error', async () => {
    const s = new KmsSealer({ ...KMS_OPTS, keyId: 'alias/does-not-exist' });
    await expect(s.publicKey()).rejects.toThrow();
  });
});
