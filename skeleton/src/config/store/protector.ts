import { decrypt, encrypt, isEncrypted } from '../../storage/encryption/cipher';
import { ENV_KEY_CURRENT, Keyring } from '../../storage/encryption/keyring';
import { ENV_KMS_KEY_ID, KmsApi, KmsProtector, kmsApiFromSdk } from './kms';

/**
 * Seals a configuration value before it is written and opens it after it is
 * read. `context` names where the value lives (`table.column`) and is bound
 * into the sealed form, so a value moved to another column fails to open.
 */
export interface ValueProtector {
  /** For logs: which protector seals new values. */
  readonly name: string;
  seal(plain: string, context: string): Promise<string>;
  open(sealed: string, context: string): Promise<string>;
  /** Whether this protector reads that sealed form. */
  reads(sealed: string): boolean;
}

/**
 * The keyring from encryption at rest (`v1.r.<kid>.…`, AES-256-GCM, random
 * mode). Its context is the AAD `EncryptedColumns` uses, so rows written
 * through `EncryptedColumns` open here and the other way round.
 */
export class KeyringProtector implements ValueProtector {
  readonly name = 'keyring';

  constructor(private readonly keyring: Keyring) {}

  async seal(plain: string, context: string): Promise<string> {
    return encrypt(this.keyring, 'random', plain, context);
  }

  async open(sealed: string, context: string): Promise<string> {
    return decrypt(this.keyring, sealed, context);
  }

  reads(sealed: string): boolean {
    return isEncrypted(sealed);
  }
}

/** Seals with the first protector; opens with whichever reads the sealed form, so rows sealed before a switch still open. */
export class ProtectorChain implements ValueProtector {
  readonly name: string;

  constructor(private readonly writer: ValueProtector, private readonly readers: ValueProtector[] = []) {
    this.name = writer.name;
  }

  seal(plain: string, context: string): Promise<string> {
    return this.writer.seal(plain, context);
  }

  open(sealed: string, context: string): Promise<string> {
    const reader = [this.writer, ...this.readers].find((p) => p.reads(sealed));
    if (!reader) return Promise.reject(new Error(`${context}: no configured protector reads this value (sealed with ${sealed.split('.')[0] || 'an unknown format'})`));
    return reader.open(sealed, context);
  }

  reads(sealed: string): boolean {
    return [this.writer, ...this.readers].some((p) => p.reads(sealed));
  }
}

/**
 * The protector the deployment configured. With `CONFIG_KMS_KEY_ID`, new
 * values are sealed with that KMS key, and the keyring, when
 * `DB_ENCRYPTION_KEY_CURRENT` is also set, still opens the values it sealed
 * before. Without it, the keyring seals. With neither, it throws: the
 * configuration holds secrets, and it is never stored unprotected.
 */
export async function protectorFromEnv(env: NodeJS.ProcessEnv = process.env, kms?: KmsApi): Promise<ValueProtector> {
  const keyring = env[ENV_KEY_CURRENT]?.trim() ? new KeyringProtector(Keyring.fromEnv(env)) : undefined;
  const keyId = env[ENV_KMS_KEY_ID]?.trim();
  if (keyId) {
    const protector = new KmsProtector(keyId, kms ?? await kmsApiFromSdk());
    return keyring ? new ProtectorChain(protector, [keyring]) : protector;
  }
  if (keyring) return keyring;
  throw new Error(`configuration store: neither ${ENV_KMS_KEY_ID} nor ${ENV_KEY_CURRENT} is set, and configuration values are never stored unprotected. Set a KMS key id, or generate a key with: openssl rand -base64 32`);
}
