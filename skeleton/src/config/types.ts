// Wire + domain types of the adapter config, protocol `adapter-config/3`.
//
// No page or field DSL: a wizard outside the adapter knows the fields of each
// config version. The adapter declares its version; GET /config prints it with
// the configured values, POST /config merges a document into the stored one
// and applies it when a value changed.
//
//   version   the adapter's config version, e.g. 'gca-config/1'. A wizard matches it.
//   ledgers   one section per ledger, keyed by CAIP-2 (e.g. eip155:2026041003)
//   custody   one section: the custodian or signer the adapter uses
//
// A section is a flat map of scalar values. Secret keys (declared by the
// adapter, e.g. private keys) arrive in plaintext, GET shows them as
// { set: true }, and the store keeps them sealed.

export type Protocol = 'adapter-config/3';
export const PROTOCOL: Protocol = 'adapter-config/3';

export type ConfigScalar = string | number | boolean;
export type ConfigSection = Record<string, ConfigScalar>;

/** What the adapter applies: plaintext. Never log it. */
export interface AdapterConfig {
  ledgers: Record<string, ConfigSection>;
  custody?: ConfigSection;
}

/** 'error' = the stored config could not be opened or applied (on boot or after a failed rollback). */
export type ConfigState = 'unconfigured' | 'configured' | 'error';

export type MaskedValue = ConfigScalar | { set: true };
export type MaskedSection = Record<string, MaskedValue>;

/** GET /config */
export interface ConfigDocument {
  protocol: Protocol;
  version: string;
  adapter: { id: string; version: string };
  state: ConfigState;
  revision: number;                // bumped on every applied change, 0 = never applied
  lastError?: string;
  ledgers: Record<string, MaskedSection>;
  custody?: MaskedSection;
}

export type PatchValue = ConfigScalar | null;

/** POST /config body. Omitted keeps; null (or "") clears a key, a ledger or the custody section. */
export interface ConfigPatch {
  version?: string;                // when given, it must equal the adapter's version
  ledgers?: Record<string, Record<string, PatchValue> | null>;
  custody?: Record<string, PatchValue> | null;
}

export interface ConfigError { path: string; code: string; message: string }   // path: 'ledgers.<id>.<key>', 'custody.<key>', '' = global

/** POST /config answer. */
export interface ApplyResult {
  ok: boolean;
  applied: boolean;                // false = nothing changed, or refused
  revision: number;
  state: ConfigState;
  errors: ConfigError[];
}

// ---- secrets at rest ----

export const SEAL_ALG = 'RSA-OAEP-256+A256GCM';
export type SealAlg = typeof SEAL_ALG;

/**
 * Envelope-encrypted secret as the adapter stores it: a fresh AES-256-GCM key
 * encrypts the value, the adapter's RSA public key (RSA-OAEP, SHA-256) wraps
 * that AES key. RSA alone caps the plaintext at 190 bytes; PEM keys are
 * bigger, hence the hybrid. All fields base64 (standard alphabet, padded).
 */
export interface SealedValue {
  enc: SealAlg;
  kid: string;         // which adapter key wrapped it
  wrappedKey: string;  // RSA-OAEP-256(aesKey)
  iv: string;          // 12 bytes
  ciphertext: string;  // AES-GCM(value) with the 16-byte tag appended
}

export const isSealedValue = (v: unknown): v is SealedValue =>
  !!v && typeof v === 'object' && (v as SealedValue).enc === SEAL_ALG
  && typeof (v as SealedValue).kid === 'string'
  && typeof (v as SealedValue).wrappedKey === 'string'
  && typeof (v as SealedValue).iv === 'string'
  && typeof (v as SealedValue).ciphertext === 'string';

/** A ledger id: CAIP-2, e.g. `eip155:2026041003`. */
export const LEDGER_ID_RE = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;

/** A key inside a section: letters, digits and `_`, 64 chars max. */
export const CONFIG_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export const ERROR_CODES = {
  badRequest: 'bad-request',
  versionMismatch: 'version-mismatch',
  badLedger: 'bad-ledger',
  badKey: 'bad-key',
  type: 'type',
  invalid: 'invalid',
  applyFailed: 'apply-failed',
  sealOpenFailed: 'seal-open-failed',
} as const;
