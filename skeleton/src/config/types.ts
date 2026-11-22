// Wire + domain types of the adapter config contract, protocol `adapter-config/2`.
//
// /1 (see ~/owneraio/adapter-config/CONTRACT.md) had ONE config per adapter.
// /2 keeps the same page/field schema but the adapter holds a config per
// KIND and KEY:
//   kind 'network'  id = the ledger (CAIP-2, e.g. eip155:11155111); one per chain
//   kind 'custody'  id = a name; the custodian (or signer) the adapter uses
//   kind 'account'  id = an account on a ledger (CAIP-10, e.g. eip155:1:0xab16...);
//                   one per investor wallet: what the adapter needs to act as
//                   that wallet on the ledger (a per-wallet RPC credential)
// An asset is never bound to a config: its ledger is already in the asset
// row (CAIP-19), and that ledger names the network config. Secrets arrive
// in plaintext and are stored sealed (envelope encrypted with the adapter's
// key: KMS or a local RSA key pair).

export type Protocol = 'adapter-config/2';
export const PROTOCOL: Protocol = 'adapter-config/2';

/** Which slot a config fills. Pages declare theirs; `network` when omitted. */
export type ConfigKind = 'network' | 'custody' | 'account';
export const CONFIG_KINDS: readonly ConfigKind[] = ['network', 'custody', 'account'];
export const DEFAULT_KIND: ConfigKind = 'network';

export type FieldType =
  | 'string' | 'text'      // text = multiline
  | 'number' | 'boolean'
  | 'enum'                 // needs options[]
  | 'url' | 'address'      // address = 0x + 40 hex
  | 'hex';                 // 0x-prefixed hex (private keys)

export type ScalarValue = string | number | boolean;

export interface FieldCondition {
  field: string;
  equals?: ScalarValue;
  in?: ScalarValue[];
}

export interface ConfigField {
  name: string;            // env-var style key, unique across all pages of a kind
  label: string;
  type: FieldType;
  required?: boolean;      // only enforced when the page/field is visible
  secret?: boolean;        // write-only. GET returns { set: boolean }
  default?: ScalarValue;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string; help?: string }>;
  pattern?: string;        // regex source, string types
  min?: number;
  max?: number;
  visibleWhen?: FieldCondition;
}

export interface ConfigPage {
  id: string;
  title: string;
  description?: string;
  /** Which kind of config this page belongs to. Default 'network'. */
  kind?: ConfigKind;
  fields: ConfigField[];
  visibleWhen?: FieldCondition;
}

export type ConfigState = 'unconfigured' | 'applying' | 'configured' | 'error';

// ---- secrets on the wire ----

export const SEAL_ALG = 'RSA-OAEP-256+A256GCM';
export type SealAlg = typeof SEAL_ALG;

/**
 * Envelope-encrypted secret as the adapter stores it: a fresh AES-256-GCM key
 * encrypts the value, the adapter's RSA
 * public key (RSA-OAEP, SHA-256) wraps that AES key. RSA alone caps the
 * plaintext at 190 bytes; PEM keys are bigger, hence the hybrid.
 * All fields base64 (standard alphabet, padded).
 */
export interface SealedValue {
  enc: SealAlg;
  kid: string;         // which adapter key wrapped it
  wrappedKey: string;  // RSA-OAEP-256(aesKey)
  iv: string;          // 12 bytes
  ciphertext: string;  // AES-GCM(value) with the 16-byte tag appended
}

// ---- descriptor (GET /config) ----

export type DescriptorValue = ScalarValue | { set: boolean };

/** One config. For kind 'network' the id is the ledger (CAIP-2), for kind 'account' CAIP-10. */
export interface ConfigSummary {
  kind: ConfigKind;
  id: string;
  name: string;
  state: ConfigState;
  version: number;                 // bumped on every apply, 0 never applied
  lastError?: string;
  /** Network kind: the ledger createAsset uses when the router names none. One per kind. An account config holds it only when an apply asked for it. */
  isDefault: boolean;
  values: Record<string, DescriptorValue>;   // secrets ONLY as { set }
}

export interface ConfigDescriptor {
  protocol: Protocol;
  adapter: { id: string; kind: string; version: string };
  pages: ConfigPage[];             // every kind; `page.kind` tells them apart
  configs: ConfigSummary[];
  readiness: { ready: boolean; blocking: string[] };   // ready = at least one configured network config
}

// ---- requests ----

export type RequestValue = ScalarValue | null;
export type RequestValues = Record<string, RequestValue>;

export interface ValidateRequest {
  kind?: ConfigKind;               // default 'network'
  id?: string;                     // validate on top of this stored config (merge semantics), else from scratch
  values: RequestValues;
}

export interface ApplyRequest {
  kind?: ConfigKind;               // default 'network'
  id: string;                      // network kind: the ledger (CAIP-2). Existing id = update (merge)
  name?: string;                   // display name, defaults to id
  default?: boolean;               // make this the default of its kind
  values: RequestValues;
}

// ---- results ----

export interface ConfigError { path: string; code: string; message: string }   // path = field name, '' = global
export interface ConfigCheck { id: string; label: string; ok: boolean; message?: string }

export interface ValidationResult { ok: boolean; errors: ConfigError[]; checks: ConfigCheck[] }

export interface ApplyResult extends ValidationResult {
  kind: ConfigKind;
  id: string;
  version?: number;
  state: ConfigState;
}

// ---- what the adapter keeps ----

/** Everything is a string, like env vars. Secrets are kept in a separate map. */
export type ConfigValues = Record<string, string>;

/** Sealed secrets as stored: field name -> envelope. */
export type SealedValues = Record<string, SealedValue>;

/** A config after activation, as handed to the adapter's ConfigHandler. */
export interface ActiveConfig {
  kind: ConfigKind;
  /** Network kind: the ledger (CAIP-2). Account kind: CAIP-10 `<ledger>:<address>`. */
  id: string;
  name: string;
  version: number;
  isDefault: boolean;
  /** Non-secret values with defaults applied. */
  values: ConfigValues;
  /** Opened (plaintext) secrets. Never log, never persist. */
  secrets: ConfigValues;
}

/**
 * Accepted ids of kinds 'network' and 'custody': CAIP-2 (`eip155:1`, `stellar:testnet`)
 * and plain names (`inmemory`, `fireblocks-sandbox`). No slash, no whitespace, 64 chars max.
 */
export const CONFIG_ID_RE = /^[A-Za-z0-9][-_.:A-Za-z0-9]{0,63}$/;

/**
 * Accepted ids of kind 'account': CAIP-10 `<namespace>:<reference>:<address>`,
 * e.g. `eip155:1:0xab16a96d359ec26a11e2c2b3d8f8b8942d5bfcdb`. An eip155 id must
 * also be lowercase (one wallet, one id); other namespaces keep their case.
 */
export const ACCOUNT_ID_RE = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/;

export const ERROR_CODES = {
  required: 'required',
  type: 'type',
  pattern: 'pattern',
  enum: 'enum',
  min: 'min',
  max: 'max',
  unknownField: 'unknown-field',
  sealOpenFailed: 'seal-open-failed',
  buildFailed: 'build-failed',
  notFound: 'not-found',
  inUse: 'in-use',
  badId: 'bad-id',
} as const;
