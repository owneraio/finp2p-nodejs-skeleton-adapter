// The adapter side of the Control Center wizard contract (host contract 2, ownera-apps
// feature/adapter-config-poc). Control Center relays each wizard step to
//   GET  <base>/config/manifest                 the manifest, a compact JWS signed by the release key
//   POST <base>/config/operations/<operationId> { context, input } with a single-use ES256 grant
// and the adapter answers { output } or { error: { code, field?, retryable? } }.
import { KeyObject } from 'node:crypto';
import { JsonObject } from './jws';

export const HOST_CONTRACT = 2;
export const MANIFEST_TYP = 'adapter-manifest+jws';
export const GRANT_TYP = 'config-grant+jwt';
/** The grant's flow for a status read, the only flow id outside ID_PATTERN. */
export const STATUS_FLOW = '_status';
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const NETWORK_ID_PATTERN = /^[a-z0-9-]{3,8}:[A-Za-z0-9._-]{1,32}$/;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export type WizardScope = 'integration' | 'network';

/** A request or response schema in the contract's JSON Schema subset. */
export interface WizardSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  properties?: Record<string, WizardSchema>;
  required?: string[];
  additionalProperties?: false;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: WizardSchema;
  maxItems?: number;
  title?: string;
  description?: string;
}

export interface WizardOperationSpec {
  request: WizardSchema;
  response: WizardSchema;
  secretFields: string[];
  idempotency: 'none' | 'required';
  limits: { maxBodyBytes: number; maxResponseBytes: number; timeoutMs: number };
}

export interface WizardFlowSpec {
  title: string;
  description?: string;
  scope: WizardScope;
  risk?: 'high';
  operations: string[];
}

/** The signed manifest payload. */
export interface WizardManifest {
  manifestVersion: 1;
  wizardId: string;
  adapter: { kind: string; name: string; version: string; imageDigest: string };
  compatibility: { hostContract: number };
  targets: { network: { id: string; label: string }[] };
  flows: Record<string, WizardFlowSpec>;
  status: { operation: string };
  operations: Record<string, WizardOperationSpec>;
}

/** What the adapter trusts about Control Center and about its own signed manifest. */
export interface WizardPins {
  issuer: string;
  audience: string;
  org: string;
  env: string;
  integrationId: string;
  wizardId: string;
  grantKid: string;
  grantPublicKey: KeyObject;
  manifestDigest: string;
}

export interface Wizard {
  pins: WizardPins;
  manifest: WizardManifest;
  /** Served as is: its digest is pinned on both sides. */
  manifestJws: string;
}

/** One verified step, as the adapter's operation sees it. */
export interface WizardCall {
  operationId: string;
  /** The manifest flow, or STATUS_FLOW for the status read. */
  flow: string;
  scope: WizardScope;
  /** The network id of a network flow. */
  targetId?: string;
  /** `user:<id>` of the admin who ran the step. */
  subject: string;
  input: JsonObject;
}

/** An operation answers its output, or throws a WizardRefusal. Anything else thrown answers 500. */
export type WizardOperation = (call: WizardCall) => Promise<JsonObject>;

export class WizardRefusal extends Error {
  readonly status: number;
  readonly field?: string;
  readonly retryable: boolean;

  /** `code` matches CODE_PATTERN; `field` is a JSON pointer such as `/apiKey`. Never a value. */
  constructor(readonly code: string, opts: { status?: number; field?: string; retryable?: boolean } = {}) {
    super(code);
    this.status = opts.status ?? 422;
    this.field = opts.field;
    this.retryable = opts.retryable ?? false;
  }
}
