// Extension points of the config module. The skeleton owns the HTTP surface,
// the merge, persistence and secrets at rest; the adapter supplies its config
// version, its secret keys and a ConfigHandler.
import { AdapterConfig, ConfigError, ConfigScalar, SealedValue } from './types';

/**
 * Holds (or reaches) the private key that can unwrap sealed secrets.
 *
 * `seal` needs only the public key, so both implementations do it locally and
 * produce the same envelope. `unwrapKey` is the only operation that touches
 * the private half: RSA private key in the adapter DB (LocalRsaSealer) or KMS
 * Decrypt (KmsSealer).
 */
export interface Sealer {
  readonly provider: 'kms' | 'local';
  /** Stable id of the wrapping key; echoed in every SealedValue.kid. */
  kid(): Promise<string>;
  /** SPKI DER, base64. */
  publicKey(): Promise<string>;
  /** RSA-OAEP-SHA256 decrypt of a wrapped AES key. Throws on bad kid/ciphertext. */
  unwrapKey(wrappedKey: Buffer, kid: string): Promise<Buffer>;
}

/** A stored value: a scalar, or a sealed envelope for a secret key. */
export type StoredValue = ConfigScalar | SealedValue;

/** The persisted document. Secrets stay sealed here. */
export interface StoredConfig {
  version: string;                 // the adapter's config version when it was applied
  revision: number;
  ledgers: Record<string, Record<string, StoredValue>>;
  custody?: Record<string, StoredValue>;
  actor?: string;
  updatedAt?: Date;
}

export type SaveConfigInput = Omit<StoredConfig, 'revision' | 'updatedAt'>;

export interface ConfigStore {
  load(): Promise<StoredConfig | undefined>;
  /** Replaces the document and bumps the revision. Returns the new revision. */
  save(input: SaveConfigInput): Promise<number>;
}

/** Where LocalRsaSealer keeps its key pair across restarts (table adapter_keys). */
export interface KeyStore {
  loadKey(): Promise<{ kid: string; privateKeyPem: string; publicKeySpki: string } | undefined>;
  saveKey(key: { kid: string; privateKeyPem: string; publicKeySpki: string }): Promise<void>;
}

/**
 * Adapter-side behaviour. Configs passed in are plaintext. Implementations
 * must bound their own network calls in time (the runtime adds an outer
 * timeout as a safety net).
 */
export interface ConfigHandler {
  /** Static and live checks of a candidate config. [] = valid. Optional. */
  validate?(config: AdapterConfig): Promise<ConfigError[]>;
  /**
   * Builds the ledger connections and the custodian from `config` and makes
   * them reachable for the services. Called on boot and on each apply that
   * changed a value. Throw to refuse: the runtime re-applies the previous
   * config (passed back as `config`, with the refused one as `previous`).
   */
  apply(config: AdapterConfig, previous: AdapterConfig | undefined): Promise<void>;
}
