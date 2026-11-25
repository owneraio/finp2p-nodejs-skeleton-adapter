// Control Center's host contract 2, the adapter side. Control Center's backend is the only caller:
//   GET  /config/manifest                   the manifest, plain JSON
//   POST /config/operations/<operationId>   { context, input }
// and the adapter answers { output } or { error: { code, field?, retryable? } }.
// No keys and no signatures: only Control Center's backend may reach these routes.
// No idempotency either: this is not a transactional API. Every operation declares
// "idempotency": "none", and an Idempotency-Key Control Center sends is ignored.
//
// ControlCenterSchema, ControlCenterFlow and ControlCenterOperationSpec (without
// `idempotency`) are shape-identical to the token-standard SPI's ControlCenterSchema,
// ControlCenterFlow and ControlCenterOperation (without `run`). The skeleton does not
// depend on that SPI; GCA checks the two against each other at compile time.
import { JsonObject } from './json';

export const HOST_CONTRACT = 2;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const NETWORK_ID_PATTERN = /^[a-z0-9-]{3,8}:[A-Za-z0-9._-]{1,32}$/;
export const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

export type ControlCenterScope = 'integration' | 'network';

/** A request or response schema in the contract's JSON Schema subset. */
export interface ControlCenterSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  properties?: Record<string, ControlCenterSchema>;
  required?: string[];
  additionalProperties?: false;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  items?: ControlCenterSchema;
  maxItems?: number;
  title?: string;
  description?: string;
}

export interface ControlCenterFlow {
  title: string;
  description?: string;
  scope: ControlCenterScope;
  risk?: 'high';
  /** The operations its screens call, by id. */
  operations: string[];
}

/** One operation as the manifest declares it. */
export interface ControlCenterOperationSpec {
  request: ControlCenterSchema;
  response: ControlCenterSchema;
  /** JSON pointers of the input fields that carry secrets. */
  secretFields: string[];
  /** Always 'none': the skeleton keeps no idempotency state. A manifest declaring 'required' does not start. */
  idempotency: 'none';
  limits: { maxBodyBytes: number; maxResponseBytes: number; timeoutMs: number };
}

export interface ControlCenterManifest {
  manifestVersion: 1;
  wizardId: string;
  adapter: { kind: string; name: string; version: string };
  compatibility: { hostContract: number };
  targets: { network: { id: string; label: string }[] };
  flows: Record<string, ControlCenterFlow>;
  status: { operation: string };
  operations: Record<string, ControlCenterOperationSpec>;
}

/** Which part of the integration a step is about, as the body's `context` carries it. */
export type ControlCenterContext = { scope: 'integration' } | { scope: 'network'; targetKind: 'network'; targetId: string };

/** One checked step, as the adapter's handler sees it. */
export interface ControlCenterCall {
  scope: ControlCenterScope;
  /** The network a network-scoped step is about (CAIP-2). */
  targetId?: string;
  input: JsonObject;
}

/**
 * Answers the output its manifest `response` declares, or throws a refusal: any error
 * with a `code` matching CODE_PATTERN, and optionally `status` (HTTP, 422 by default),
 * `field` (a JSON pointer into the input) and `retryable`. Anything else thrown answers
 * 500 INTERNAL_ERROR. Control Center words every refusal itself: never put a value in one.
 */
export type ControlCenterOperationHandler = (call: ControlCenterCall) => Promise<JsonObject>;

/** The structural shape of a refusal. No class to extend: any thrown object with a valid `code` is one. */
export interface ControlCenterRefusal { code: string; status?: number; field?: string; retryable?: boolean }
