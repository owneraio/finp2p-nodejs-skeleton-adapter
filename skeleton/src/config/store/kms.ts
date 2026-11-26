import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ValueProtector } from './protector';

export const ENV_KMS_KEY_ID = 'CONFIG_KMS_KEY_ID';

const FORMAT = /^kms1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CONTEXT_KEY = 'finp2p:config-value';

/** The two KMS calls the protector makes, as `@aws-sdk/client-kms` answers them. */
export interface KmsApi {
  generateDataKey(input: { KeyId: string; KeySpec: 'AES_256'; EncryptionContext: Record<string, string> }): Promise<{ CiphertextBlob?: Uint8Array; Plaintext?: Uint8Array }>;
  decrypt(input: { CiphertextBlob: Uint8Array; EncryptionContext: Record<string, string> }): Promise<{ Plaintext?: Uint8Array }>;
}

interface KmsSdk {
  KMSClient: new (config: object) => { send(command: unknown): Promise<never> };
  GenerateDataKeyCommand: new (input: object) => unknown;
  DecryptCommand: new (input: object) => unknown;
}

/**
 * The KMS API over `@aws-sdk/client-kms`, which the adapter installs only if
 * it uses KMS. Region, endpoint and credentials come from the SDK's own
 * environment (AWS_REGION, AWS_ENDPOINT_URL, the role).
 */
export async function kmsApiFromSdk(): Promise<KmsApi> {
  const name = '@aws-sdk/client-kms';
  let sdk: KmsSdk;
  try {
    sdk = await import(name) as KmsSdk;
  } catch {
    throw new Error(`${ENV_KMS_KEY_ID} is set but ${name} is not installed: add it to the adapter's dependencies`);
  }
  const client = new sdk.KMSClient({});
  return {
    generateDataKey: (input) => client.send(new sdk.GenerateDataKeyCommand(input)),
    decrypt: (input) => client.send(new sdk.DecryptCommand(input)),
  };
}

/** Keeps a KMS failure's name only: an SDK error carries the request. */
const kmsFailure = (what: string, e: unknown) => new Error(`kms ${what} failed: ${e instanceof Error && e.name ? e.name : 'unknown'}`);

/**
 * Envelope encryption with a symmetric KMS key: each value is sealed with its
 * own data key (AES-256-GCM, the context as AAD), and the data key is stored
 * wrapped by KMS under the same context. The KMS key never leaves KMS.
 * Sealed form: `kms1.<wrapped data key>.<iv || ciphertext || tag>`, both
 * base64url. Decrypt needs no key id, since the wrapped key names its own,
 * so values sealed before an alias moved to a new key still open.
 * The adapter's role needs kms:GenerateDataKey and kms:Decrypt on the key.
 */
export class KmsProtector implements ValueProtector {
  readonly name = 'kms';

  constructor(private readonly keyId: string, private readonly api: KmsApi) {}

  async seal(plain: string, context: string): Promise<string> {
    let key: { CiphertextBlob?: Uint8Array; Plaintext?: Uint8Array };
    try {
      key = await this.api.generateDataKey({ KeyId: this.keyId, KeySpec: 'AES_256', EncryptionContext: { [CONTEXT_KEY]: context } });
    } catch (e) {
      throw kmsFailure('generate data key', e);
    }
    if (!key.CiphertextBlob || !key.Plaintext) throw new Error('kms generate data key failed: no key returned');
    const dataKey = Buffer.from(key.Plaintext);
    try {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const body = Buffer.concat([iv, cipher.update(Buffer.from(plain, 'utf8')), cipher.final(), cipher.getAuthTag()]);
      return `kms1.${Buffer.from(key.CiphertextBlob).toString('base64url')}.${body.toString('base64url')}`;
    } finally {
      dataKey.fill(0);
    }
  }

  async open(sealed: string, context: string): Promise<string> {
    const m = FORMAT.exec(sealed);
    if (!m) throw new Error(`${context}: not a KMS-sealed value`);
    const body = Buffer.from(m[2], 'base64url');
    if (body.length < IV_BYTES + TAG_BYTES) throw new Error(`${context}: not a KMS-sealed value`);
    let key: { Plaintext?: Uint8Array };
    try {
      key = await this.api.decrypt({ CiphertextBlob: Buffer.from(m[1], 'base64url'), EncryptionContext: { [CONTEXT_KEY]: context } });
    } catch (e) {
      throw kmsFailure('decrypt', e);
    }
    if (!key.Plaintext) throw new Error('kms decrypt failed: no key returned');
    const dataKey = Buffer.from(key.Plaintext);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dataKey, body.subarray(0, IV_BYTES));
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      return Buffer.concat([decipher.update(body.subarray(IV_BYTES, body.length - TAG_BYTES)), decipher.final()]).toString('utf8');
    } catch {
      throw new Error(`${context}: ciphertext failed authentication (modified data, or moved between columns)`);
    } finally {
      dataKey.fill(0);
    }
  }

  reads(sealed: string): boolean {
    return sealed.startsWith('kms1.');
  }
}
