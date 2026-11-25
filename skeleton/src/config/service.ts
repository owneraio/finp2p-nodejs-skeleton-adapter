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
  /** Merged into GET /config/status (its `applied` answered as null when absent), and Control Center's get-status. */
  status(): ConfigStatus | Promise<ConfigStatus>;
  /** The secrets in the clear, so the routes can scrub them out of every message they answer. */
  sealedValues(): Promise<string[]>;

  // ---- what Control Center's manifest is derived from (control-center/derive.ts) ----

  /** The configuration steps, in order. Read once, at registerConfigRoutes. */
  steps(): ConfigurationStep[];
  /**
   * Stores what a step derives from `input` (all or none), runs the step's checks on the
   * stored values, and reports them. `input` is keyed by input id, every value a string
   * (an integer input arrives as its decimal string). An empty secret input keeps the
   * stored secret. Requirements the manifest cannot express (one that depends on other
   * values, a secret not yet stored) are the service's to enforce here. Throw for an unknown
   * step: steps are fixed at registration, so that is a fault, answered 500.
   */
  saveStep(stepId: string, input: Record<string, string>): Promise<StepSaveResult>;
  /** The networks (CAIP-2) the adapter can be configured for, with their labels. Read once, at registerConfigRoutes. */
  networks(): { id: string; label: string }[];
  /** Short facts about the applied configuration for Control Center's status view. Never a secret (scrubbed anyway). */
  summary(): Promise<ConfigSummaryItem[]>;

  /**
   * Runs a configuration action by its ref (one an integration lists in schema(), such as
   * creating an agreement on the ledger). Optional: without it POST /config/actions/:ref
   * answers 404. Not part of Control Center's manifest.
   */
  runAction?(ref: string, input: Record<string, unknown>): Promise<ConfigActionOutcome>;
}

export interface ConfigActionOutcome {
  /** 'done' is answered 200, 'refused' 422; the outcome is the body either way. */
  status: 'done' | 'refused';
  /** Scrubbed of sealedValues() before it is answered, like `details` values. */
  message: string;
  details?: { label: string; value: string }[];
  /** What the action changed, answered as is: never put a secret in it. */
  applied?: unknown;
}

export type ConfigState = 'unconfigured' | 'active' | 'failed';

export interface ConfigStatus {
  state: ConfigState;
  /** Why the adapter is failed; shown scrubbed. */
  error?: string;
  applied?: ConfigAppliedVersion | null;
  [key: string]: unknown;
}

/** One thing a person enters in a step. */
export interface ConfigurationInput {
  /** Becomes a JSON pointer (`/<id>`) in refusals: letters, digits, `.`, `_` and `-`, 64 at most. */
  id: string;
  label: string;
  type: 'string' | 'url' | 'enum' | 'integer' | 'address';
  /** `secret` inputs are never required by the manifest: left empty, the stored value stays. */
  classification: 'public' | 'confidential' | 'secret';
  /** Required unconditionally. A requirement that depends on other values is the service's to enforce in saveStep. */
  required?: boolean;
  default?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  /** A JavaScript regular expression (unicode mode) the value must match, checked by the manifest. */
  format?: { pattern: string; message: string };
}

export interface ConfigurationStep {
  /** Lowercase letters, digits and dashes, 59 at most (its operation is `save-<id>`). */
  id: string;
  title: string;
  description?: string;
  inputs: ConfigurationInput[];
}

export type StepCheck =
  | { ref: string; status: 'valid' | 'invalid'; message: string }
  | { ref: string; status: 'missing'; missing: string[] };

export type StepSaveResult =
  | { saved: true; checks: StepCheck[] }
  /** Nothing stored. `input` names the input at fault when there is one; `reason` stays in the adapter (Control Center words refusals itself). */
  | { refused: 'invalid-input'; input?: string; reason: string };

export interface ConfigSummaryItem { id: string; label: string; value: string }
