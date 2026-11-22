// Extension points of the config module. The skeleton owns the HTTP surface,
// validation, persistence and secret handling; the adapter supplies the pages
// (data) and a ConfigHandler (behaviour).
import {
  ActiveConfig, ConfigCheck, ConfigKind, ConfigValues, SealedValue, SealedValues,
} from './types';

/**
 * Holds (or reaches) the private key that can unwrap sealed secrets.
 *
 * `seal` needs only the public key, so both implementations do it locally and
 * produce the same envelope. `unwrapKey` is the only
 * operation that touches the private half: RSA private key in the adapter DB
 * (LocalRsaSealer) or KMS Decrypt (KmsSealer).
 */
export interface Sealer {
  readonly provider: 'kms' | 'local';
  /** Stable id of the wrapping key; echoed in every SealedValue.kid. */
  kid(): Promise<string>;
  /** SPKI DER, base64. Published in the descriptor. */
  publicKey(): Promise<string>;
  /** RSA-OAEP-SHA256 decrypt of a wrapped AES key. Throws on bad kid/ciphertext. */
  unwrapKey(wrappedKey: Buffer, kid: string): Promise<Buffer>;
}

/** `(kind, id)` names one config. */
export interface ConfigRef {
  kind: ConfigKind;
  id: string;
}

/** Persisted shape of one config. Secrets stay sealed here. */
export interface StoredConfig extends ConfigRef {
  name: string;
  isDefault: boolean;
  version: number;
  values: ConfigValues;
  secrets: SealedValues;
  actor?: string;
  updatedAt?: Date;
}

export interface SaveConfigInput extends ConfigRef {
  name: string;
  isDefault: boolean;
  values: ConfigValues;
  secrets: SealedValues;
  actor?: string;
}

export interface ConfigStore {
  list(): Promise<StoredConfig[]>;
  get(ref: ConfigRef): Promise<StoredConfig | undefined>;
  /** Upsert. Bumps version. When isDefault, clears the flag on every other row of the kind (same transaction). Returns the new version. */
  save(input: SaveConfigInput): Promise<number>;
  /** Throws ERROR_CODES.notFound when there is no such row. */
  remove(ref: ConfigRef): Promise<void>;
}

/** Where LocalRsaSealer keeps its key pair across restarts (table adapter_keys). */
export interface KeyStore {
  loadKey(): Promise<{ kid: string; privateKeyPem: string; publicKeySpki: string } | undefined>;
  saveKey(key: { kid: string; privateKeyPem: string; publicKeySpki: string }): Promise<void>;
}

/**
 * Adapter-side behaviour. Values passed in already have defaults applied and
 * secrets opened. Implementations must bound their own network calls in time
 * (the runtime adds an outer timeout as a safety net).
 */
export interface ConfigHandler {
  /** Live probes (rpc chainId, contract code, custody api ...). Static validation already passed. */
  check?(ref: ConfigRef, values: ConfigValues, secrets: ConfigValues): Promise<ConfigCheck[]>;
  /** Build the slot for this config (a network's connection, the custodian client) and make it reachable for the services. */
  activate(config: ActiveConfig): Promise<void>;
  /**
   * Tear down a slot: config removed, replaced by a new version, or its
   * activation failed / timed out after registering resources. Must be
   * idempotent and tolerate refs it never activated. Optional.
   */
  deactivate?(ref: ConfigRef): Promise<void>;
  /**
   * Whether removing this config would orphan something (assets on the
   * network, a network that names this custodian). A string names what;
   * `false`/`undefined` allows the removal. Optional: without it every
   * config can be removed.
   */
  inUse?(ref: ConfigRef): Promise<string | false | undefined>;
}

/** Marker for values that are secrets on the wire but arrived in plaintext. */
export type IncomingSecret = { plain: string } | { sealed: SealedValue };
