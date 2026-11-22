// The adapter side of the Control Center wizard contract (host contract 2, ownera-apps
// feature/adapter-config-poc since 9a345a3b1). Control Center's backend is the only caller:
//   GET  <base>/config/manifest                 the manifest, plain JSON
//   POST <base>/config/operations/<operationId> { context, input }, an Idempotency-Key when required
// and the adapter answers { output } or { error: { code, field?, retryable? } }.
// No keys and no signatures: the configuration API must be reachable only from Control Center's backend.
import { JsonObject } from './json';

export const HOST_CONTRACT = 2;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const NETWORK_ID_PATTERN = /^[a-z0-9-]{3,8}:[A-Za-z0-9._-]{1,32}$/;
export const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
/** A lowercase UUID, as Control Center sends it. */
export const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

export interface WizardManifest {
  manifestVersion: 1;
  wizardId: string;
  adapter: { kind: string; name: string; version: string };
  compatibility: { hostContract: number };
  targets: { network: { id: string; label: string }[] };
  flows: Record<string, WizardFlowSpec>;
  status: { operation: string };
  operations: Record<string, WizardOperationSpec>;
}

/** Which part of the integration a step is about, as the body's `context` carries it. */
export type WizardContext = { scope: 'integration' } | { scope: 'network'; targetKind: 'network'; targetId: string };

/** One checked step, as the adapter's operation sees it. */
export interface WizardCall {
  operationId: string;
  scope: WizardScope;
  /** The network id of a network step. */
  targetId?: string;
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
