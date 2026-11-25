// What the adapter supplies behind the configuration routes. The skeleton owns the HTTP
// surface (routes.ts); the adapter owns the engine: the store, encryption, the schema,
// the named checks, and what applying means. The skeleton knows none of its fields.

/** A check's outcome as the adapter records it. `details` are labelled values to show. */
export interface ConfigCheckRecord {
  status: 'valid' | 'invalid';
  message: string;
  details?: { label: string; value: string }[];
  [key: string]: unknown;
}

export type ConfigCheckRun =
  | { kind: 'ran'; record: ConfigCheckRecord }
  /** No check by that ref. Answered 404. */
  | { kind: 'unknown' }
  /** The check does not apply to the current values. Answered 409. */
  | { kind: 'inactive' }
  /** Inputs the check needs are unset, by field id. Answered 409 with them. */
  | { kind: 'missing'; missing: string[] };

export interface ConfigProblem {
  /** 'activation' when the adapter did not start on the values; anything else means incomplete. */
  kind: string;
  ref: string;
  message: string;
}

export interface ConfigAppliedVersion { version: number; appliedAt: string }

export type ConfigApplyOutcome =
  | { ok: true; applied: ConfigAppliedVersion }
  | { ok: false; problems: ConfigProblem[] };

export interface ConfigurationService {
  /** GET /config/schema, answered as is. */
  schema(): object | Promise<object>;
  /** GET /config/values and the answer to a stored PUT. Secrets must already be masked in it. */
  view(): object | Promise<object>;
  /** Stores all or none; null clears a field. Answers the refused fields by id with the reason, {} when stored. */
  write(values: Record<string, string | null>): Promise<Record<string, string>>;
  /** Runs one check on the stored values. Bound it in time: the route waits for it. */
  check(refId: string, scope: 'field' | 'group'): Promise<ConfigCheckRun>;
  /** Applies the stored values. On failure the previous version must stay applied. */
  apply(): Promise<ConfigApplyOutcome>;
  /** Merged into GET /config/status. Its `applied` is answered as null when absent. */
  status(): { applied?: ConfigAppliedVersion | null; [key: string]: unknown } | Promise<{ applied?: ConfigAppliedVersion | null; [key: string]: unknown }>;
  /** The secrets in the clear, so the routes can scrub them out of every message they answer. */
  sealedValues(): Promise<string[]>;
}
