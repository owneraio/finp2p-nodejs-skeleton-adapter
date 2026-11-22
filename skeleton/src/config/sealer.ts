// The two Sealer implementations: an RSA key pair kept by the adapter itself
// (LocalRsaSealer, persisted through a KeyStore) and an AWS KMS asymmetric key
// (KmsSealer, the private half never leaves KMS). Both publish the same SPKI
// public key shape, so the stored envelope is the same whichever is used.
import {
  constants, createHash, createPublicKey, createPrivateKey, generateKeyPairSync, KeyObject, privateDecrypt,
} from 'node:crypto';
import type { KMSClient as KMSClientType, KMSClientConfig } from '@aws-sdk/client-kms';
import { logger } from '../helpers/logger';
import { KeyStore, Sealer } from './interfaces';

const RSA_OAEP_SHA256 = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;

const kidOfSpki = (spkiDer: Buffer): string =>
  `local:${createHash('sha256').update(spkiDer).digest('hex').slice(0, 16)}`;

// ---- local ----

export class LocalRsaSealer implements Sealer {
  readonly provider = 'local' as const;

  private constructor(
    private readonly privateKey: KeyObject,
    private readonly publicKeySpki: string,
    private readonly keyId: string,
  ) {}

  /** Load the pair from `keyStore`, or generate RSA-2048 and save it when a store is given. */
  static async create(keyStore?: KeyStore): Promise<LocalRsaSealer> {
    const stored = await keyStore?.loadKey();
    if (stored) {
      const privateKey = createPrivateKey(stored.privateKeyPem);
      const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer;
      const publicKeySpki = spki.toString('base64');
      // the key is what it is; the stored kid wins only when it still matches the key
      const kid = stored.kid === kidOfSpki(spki) ? stored.kid : kidOfSpki(spki);
      if (publicKeySpki !== stored.publicKeySpki || kid !== stored.kid) {
        logger.warning('local sealer: stored public key / kid did not match the private key, recomputed');
      }
      return new LocalRsaSealer(privateKey, publicKeySpki, kid);
    }
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const spki = pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const sealer = new LocalRsaSealer(pair.privateKey, spki.toString('base64'), kidOfSpki(spki));
    if (keyStore) {
      await keyStore.saveKey({
        kid: sealer.keyId,
        privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
        publicKeySpki: sealer.publicKeySpki,
      });
    }
    return sealer;
  }

  async kid(): Promise<string> {
    return this.keyId;
  }

  async publicKey(): Promise<string> {
    return this.publicKeySpki;
  }

  async unwrapKey(wrappedKey: Buffer, kid: string): Promise<Buffer> {
    if (kid !== this.keyId) throw new Error('unknown kid');
    try {
      return privateDecrypt({ key: this.privateKey, ...RSA_OAEP_SHA256 }, wrappedKey);
    } catch {
      // node's message may mention the padding internals, never the data; keep it generic anyway
      throw new Error('rsa unwrap failed');
    }
  }
}

// ---- kms ----

export interface KmsSealerOptions {
  /** Key id, key ARN or `alias/<name>`. */
  keyId: string;
  client?: KMSClientType;
  region?: string;
  endpoint?: string;
  credentials?: KMSClientConfig['credentials'];
}

interface KmsPublicKey { arn: string; spkiBase64: string }

/** A KMS key ARN of any partition (aws, aws-cn, aws-us-gov ...). */
const KMS_KEY_ARN_RE = /^arn:aws[a-z-]*:kms:[^:]*:\d*:key\/[^/]+$/;

export class KmsSealer implements Sealer {
  readonly provider = 'kms' as const;

  private readonly keyId: string;

  private client: KMSClientType | undefined;

  private readonly clientConfig: KMSClientConfig;

  private cached: Promise<KmsPublicKey> | undefined;

  constructor(opts: KmsSealerOptions) {
    this.keyId = opts.keyId;
    this.client = opts.client;
    this.clientConfig = {
      ...(opts.region ? { region: opts.region } : {}),
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    };
  }

  private async sdk() {
    // lazy so adapters without KMS never load the SDK
    return import('@aws-sdk/client-kms');
  }

  private async getClient(): Promise<KMSClientType> {
    if (!this.client) {
      const { KMSClient } = await this.sdk();
      this.client = new KMSClient(this.clientConfig);
    }
    return this.client;
  }

  private load(): Promise<KmsPublicKey> {
    if (!this.cached) {
      this.cached = this.fetchPublicKey().catch((e) => {
        this.cached = undefined;   // retry next time
        throw e;
      });
    }
    return this.cached;
  }

  private async fetchPublicKey(): Promise<KmsPublicKey> {
    const { GetPublicKeyCommand } = await this.sdk();
    const client = await this.getClient();
    const out = await client.send(new GetPublicKeyCommand({ KeyId: this.keyId }));
    if (!out.PublicKey || !out.KeyId) throw new Error('kms GetPublicKey returned no key');
    if (!out.KeySpec?.startsWith('RSA')) {
      throw new Error(`kms key ${this.keyId} must be an RSA key, got ${out.KeySpec ?? 'unknown'}`);
    }
    if (out.KeyUsage !== 'ENCRYPT_DECRYPT') {
      throw new Error(`kms key ${this.keyId} must have KeyUsage ENCRYPT_DECRYPT, got ${out.KeyUsage ?? 'unknown'}`);
    }
    return { arn: out.KeyId, spkiBase64: Buffer.from(out.PublicKey).toString('base64') };
  }

  async kid(): Promise<string> {
    return (await this.load()).arn;
  }

  async publicKey(): Promise<string> {
    return (await this.load()).spkiBase64;
  }

  /**
   * `kid` is the current key (ARN or the configured key id) or a previous key
   * ARN: after the alias was repointed to a new key, envelopes written before
   * still carry the old ARN and still open while that key exists in KMS. The
   * runtime pins new requests to the current kid, so an old ARN can only come
   * from rows the adapter wrote itself; IAM bounds which keys the role may use.
   */
  async unwrapKey(wrappedKey: Buffer, kid: string): Promise<Buffer> {
    const { arn } = await this.load();
    const current = kid === arn || kid === this.keyId;
    if (!current && !KMS_KEY_ARN_RE.test(kid)) throw new Error('unknown kid');
    const { DecryptCommand } = await this.sdk();
    const client = await this.getClient();
    let plaintext: Uint8Array | undefined;
    try {
      ({ Plaintext: plaintext } = await client.send(new DecryptCommand({
        KeyId: current ? arn : kid,
        CiphertextBlob: wrappedKey,
        EncryptionAlgorithm: 'RSAES_OAEP_SHA_256',
      })));
    } catch (e) {
      // SDK errors carry the request; keep only the error class name
      const name = e instanceof Error && e.name ? e.name : 'unknown';
      throw new Error(`kms decrypt failed: ${name}`);
    }
    if (!plaintext) throw new Error('kms decrypt failed: no plaintext');
    return Buffer.from(plaintext);
  }
}

// ---- env ----

/** KMS_KEY_ID set -> KmsSealer, else a local key pair (persisted through `keyStore` when given). */
export async function sealerFromEnv(env: NodeJS.ProcessEnv = process.env, keyStore?: KeyStore): Promise<Sealer> {
  if (env.KMS_KEY_ID) {
    logger.info(`config sealer: kms (key ${env.KMS_KEY_ID}${env.AWS_ENDPOINT_URL ? `, endpoint ${env.AWS_ENDPOINT_URL}` : ''})`);
    return new KmsSealer({ keyId: env.KMS_KEY_ID, region: env.AWS_REGION, endpoint: env.AWS_ENDPOINT_URL });
  }
  logger.info(`config sealer: local rsa key pair (${keyStore ? 'persisted in key store' : 'in memory only'})`);
  return LocalRsaSealer.create(keyStore);
}
