// What an adapter supplies behind the configuration routes: the store, encryption, the fields,
// the checks and what applying means. The skeleton knows none of its fields.

export interface ConfigCheckRecord {
  status: 'valid' | 'invalid';
  message: string;
  details?: { label: string; value: string }[];
  [key: string]: unknown;
}

export type ConfigCheckRun =
  | { kind: 'ran'; record: ConfigCheckRecord }
  | { kind: 'unknown' }
  | { kind: 'inactive' }
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

export type ConfigState = 'unconfigured' | 'active' | 'failed';

export interface ConfigStatus {
  state: ConfigState;
  error?: string;
  applied?: ConfigAppliedVersion | null;
  [key: string]: unknown;
}

export interface ConfigActionOutcome {
  status: 'done' | 'refused';
  message: string;
  details?: { label: string; value: string }[];
  /** Answered as is: never put a secret in it. */
  applied?: unknown;
}

export interface ConfigurationInput {
  /** Letters, digits, `.`, `_` and `-`, 64 at most. Control Center sees each `.` as `_`. */
  id: string;
  label: string;
  type: 'string' | 'url' | 'enum' | 'integer' | 'address';
  /** A secret is never schema-required: left empty, the stored value stays. */
  classification: 'public' | 'confidential' | 'secret';
  /** Unconditional; a requirement that depends on other values is saveStep's to enforce. */
  required?: boolean;
  default?: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  help?: string;
  /** Left to saveStep when Control Center would refuse the pattern. */
  format?: { pattern: string; message: string };
}

export interface ConfigurationStep {
  /** Lowercase letters, digits and dashes, 59 at most. */
  id: string;
  title: string;
  description?: string;
  inputs: ConfigurationInput[];
}

export type StepCheck =
  | { ref: string; status: 'valid' | 'invalid'; message: string; details?: { label: string; value: string }[] }
  | { ref: string; status: 'missing'; missing: string[] };

export type StepSaveResult =
  | { saved: true; checks: StepCheck[] }
  /** Nothing stored; `reason` stays in the adapter. */
  | { refused: 'invalid-input'; input?: string; reason: string };

export interface ConfigSummaryItem { id: string; label: string; value: string }

export interface ConfigurationService {
  schema(): object | Promise<object>;
  /** Secrets already masked. */
  view(): object | Promise<object>;
  /** All or none; null clears a field. Answers the refused fields with their reasons, {} when stored. */
  write(values: Record<string, string | null>): Promise<Record<string, string>>;
  check(refId: string, scope: 'field' | 'group'): Promise<ConfigCheckRun>;
  /** On failure the previous version stays applied. */
  apply(): Promise<ConfigApplyOutcome>;
  status(): ConfigStatus | Promise<ConfigStatus>;
  /** The secrets in the clear, scrubbed out of every message the routes answer. */
  sealedValues(): Promise<string[]>;

  /** Read once, at registration. */
  steps(): ConfigurationStep[];
  /**
   * Stores what a step derives from `input` (keyed by input id, every value a string), then runs
   * the step's checks. An empty secret keeps the stored one. Throws for an unknown step.
   */
  saveStep(stepId: string, input: Record<string, string>): Promise<StepSaveResult>;
  /** CAIP-2 ids with labels. Read once, at registration. */
  networks(): { id: string; label: string }[];
  /** Facts about the applied configuration for the status view. */
  summary(): Promise<ConfigSummaryItem[]>;
  /** Without it POST /config/actions/:ref answers 404. */
  runAction?(ref: string, input: Record<string, unknown>): Promise<ConfigActionOutcome>;
  /** Stored values by step and input id, a secret only as `{ sealed: true }`. Without it there is no get-values. */
  inputValues?(): Promise<Record<string, Record<string, string | { sealed: true }>>>;
}
