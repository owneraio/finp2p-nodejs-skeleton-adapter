// Control Center's host contract 2: GET /config/manifest, and POST /config/operations/<id> with
// { context, input } answered { output } or { error: { code, field?, retryable? } }.
import { JsonObject } from './json';

export const HOST_CONTRACT = 2;
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const NETWORK_ID_PATTERN = /^[a-z0-9-]{3,8}:[A-Za-z0-9._-]{1,32}$/;
export const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The JSON Schema subset Control Center compiles. */
export interface ControlCenterSchema {
  type: 'object' | 'string' | 'integer' | 'boolean' | 'array';
  properties?: Record<string, ControlCenterSchema>;
  required?: string[];
  additionalProperties?: false;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  enum?: string[];
  items?: ControlCenterSchema;
  maxItems?: number;
  title?: string;
  description?: string;
}

export interface ControlCenterOperationSpec {
  request: ControlCenterSchema;
  response: ControlCenterSchema;
  /** JSON pointers of the input fields that carry secrets. */
  secretFields: string[];
  idempotency: 'none';
  limits: { maxBodyBytes: number; maxResponseBytes: number; timeoutMs: number };
}

export interface ControlCenterManifest {
  manifestVersion: 1;
  wizardId: string;
  adapter: { kind: string; name: string; version: string };
  compatibility: { hostContract: number };
  targets: { network: { id: string; label: string }[] };
  flows: Record<string, { title: string; scope: 'integration'; operations: string[] }>;
  status: { operation: string };
  operations: Record<string, ControlCenterOperationSpec>;
}

/** Answers the declared response, or throws a refusal: any object with a `code` matching CODE_PATTERN. */
export type ControlCenterOperationHandler = (input: JsonObject) => Promise<JsonObject>;

export interface ControlCenterRefusal { code: string; status?: number; field?: string; retryable?: boolean }
