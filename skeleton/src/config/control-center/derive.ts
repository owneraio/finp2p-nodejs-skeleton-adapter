// Control Center's manifest and operations, derived from the adapter's neutral description
// (steps, networks, summary, status, apply). Adapters never write a manifest: this is the
// only place that knows Control Center's flows, operation names, codes and status words.
//
//   flow `configure` (integration): save-<stepId> for each step in order, then activate
//   save-<stepId>  { <inputId>: value }  -> { valid, message }   saveStep, then its checks
//   activate       {}                    -> { version, appliedAt } apply
//   get-status     {}                    -> { state, details }    status + summary
import { scrub } from '../scrub';
import {
  ConfigurationInput, ConfigurationService, ConfigurationStep, ConfigState, StepCheck,
} from '../service';
import { JsonObject } from './json';
import { checkManifest } from './manifest';
import {
  ControlCenterManifest, ControlCenterOperationHandler, ControlCenterOperationSpec, ControlCenterRefusal, ControlCenterSchema, HOST_CONTRACT,
} from './types';

export interface ControlCenterIdentity {
  /** Control Center's id for this adapter's wizard: lowercase letters, digits and dashes. */
  wizardId: string;
  adapter: { kind: string; name: string; version: string };
  /** Declared per operation; must cover every check a step runs. Default and Control Center's ceiling: 30 s. */
  timeoutMs?: number;
}

export const STATUS_OPERATION = 'get-status';
export const ACTIVATE_OPERATION = 'activate';
export const CONFIGURE_FLOW = 'configure';
export const saveOperation = (stepId: string): string => `save-${stepId}`;

export const DEFAULT_TIMEOUT_MS = 30_000;
export const STRING_MAX = 4096;
export const URL_MAX = 2048;
export const URL_PATTERN = '^https?://\\S+$';
const HARD_BODY_CAP = 64 * 1024;
const MESSAGE_MAX = 1024;
const DETAILS_MAX = 32;
const DETAIL_ID_MAX = 64;
const LABEL_MAX = 128;
const VALUE_MAX = 512;

/** Control Center's own bounds (ownera-apps AdapterConfig schema.ts), checked here so a manifest it would refuse never starts. */
const MAX_INPUTS = 32;
const MAX_STEPS = 31; // the configure flow lists 32 operations at most, activate included
const MAX_PATTERN_LENGTH = 256;
const MAX_ANNOTATION_LENGTH = 256;

const STEP_ID = /^[a-z0-9][a-z0-9-]{0,58}$/;
const INPUT_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Control Center's status words for the adapter's states. */
export const CONTROL_CENTER_STATE: Record<ConfigState, string> = {
  unconfigured: 'not_configured',
  active: 'active',
  failed: 'needs_attention',
};

/** A refusal as routes.ts reads it: an Error carrying the code (its message is the code alone, never a value). */
const refuse = (code: string, extra: Omit<ControlCenterRefusal, 'code'> = {}): Error & ControlCenterRefusal =>
  Object.assign(new Error(code), { code, ...extra });

const clip = (text: string, max: number): string => ([...text].length > max ? `${[...text].slice(0, max - 1).join('')}…` : text);

const object = (properties: Record<string, ControlCenterSchema>, required: string[] = []): ControlCenterSchema =>
  ({ type: 'object', additionalProperties: false, properties, required });

function checkPattern(pattern: string, where: string): string {
  // Control Center also refuses a pattern that could backtrack badly (nested or stacked quantifiers,
  // backreferences, lookarounds); keep formats simple, or check the value in saveStep instead
  if (pattern.length > MAX_PATTERN_LENGTH) throw new Error(`configuration input ${where}: format.pattern is longer than ${MAX_PATTERN_LENGTH}`);
  try {
    new RegExp(pattern, 'u'); // eslint-disable-line no-new
  } catch {
    throw new Error(`configuration input ${where}: format.pattern is not a valid regular expression`);
  }
  return pattern;
}

/** The request schema of one input. Exported for tests. */
export function inputSchema(input: ConfigurationInput, where: string): ControlCenterSchema {
  const described = { title: clip(input.label, MAX_ANNOTATION_LENGTH), ...(input.help ? { description: clip(input.help, MAX_ANNOTATION_LENGTH) } : {}) };
  const pattern = input.format ? checkPattern(input.format.pattern, where) : undefined;
  switch (input.type) {
    case 'integer':
      return { type: 'integer', ...described };
    case 'enum': {
      const values = (input.options ?? []).map((o) => o.value);
      if (!values.length) throw new Error(`configuration input ${where}: an enum needs options`);
      return { type: 'string', enum: values, maxLength: Math.max(...values.map((v) => [...v].length)), ...described };
    }
    case 'url':
      return { type: 'string', maxLength: URL_MAX, pattern: pattern ?? URL_PATTERN, ...described };
    case 'string':
    case 'address':
      return { type: 'string', maxLength: STRING_MAX, ...(pattern ? { pattern } : {}), ...described };
    default:
      throw new Error(`configuration input ${where}: unknown type ${(input as { type: string }).type}`);
  }
}

/** Required in the manifest only when unconditionally required and not a secret (an empty secret keeps the stored one). */
const schemaRequired = (input: ConfigurationInput): boolean => input.required === true && input.classification !== 'secret';

function stepSpec(step: ConfigurationStep, timeoutMs: number): ControlCenterOperationSpec {
  if (!STEP_ID.test(step.id)) throw new Error(`configuration step ${step.id}: the id must be lowercase letters, digits and dashes, 59 at most`);
  if (step.inputs.length > MAX_INPUTS) throw new Error(`configuration step ${step.id}: more than ${MAX_INPUTS} inputs`);
  const properties: Record<string, ControlCenterSchema> = {};
  for (const input of step.inputs) {
    const where = `${step.id}/${input.id}`;
    if (!INPUT_ID.test(input.id)) throw new Error(`configuration input ${where}: the id must be letters, digits, ., _ and -, 64 at most`);
    if (properties[input.id]) throw new Error(`configuration input ${where}: declared twice`);
    properties[input.id] = inputSchema(input, where);
    if (schemaRequired(input) && properties[input.id].type === 'string') properties[input.id].minLength = 1;
  }
  // JSON can escape a character to 6 bytes; the envelope and keys get a fixed allowance
  const inputBytes = Object.values(properties).reduce((sum, p) => sum + (p.type === 'integer' ? 32 : (p.maxLength ?? STRING_MAX) * 6), 0);
  return {
    request: object(properties, step.inputs.filter(schemaRequired).map((i) => i.id)),
    response: object({ valid: { type: 'boolean' }, message: { type: 'string', maxLength: MESSAGE_MAX } }, ['valid', 'message']),
    secretFields: step.inputs.filter((i) => i.classification === 'secret').map((i) => `/${i.id}`),
    idempotency: 'none',
    limits: { maxBodyBytes: Math.min(HARD_BODY_CAP, 1024 + 128 * step.inputs.length + inputBytes), maxResponseBytes: 4096, timeoutMs },
  };
}

const noInput = object({});

/** What a save answers: the first check that failed or could not run, else the first check's message. */
export function saveAnswer(checks: StepCheck[], secrets: string[]): { valid: boolean; message: string } {
  const failed = checks.find((c) => c.status !== 'valid');
  const message = (c: StepCheck): string => (c.status === 'missing' ? `Missing: ${c.missing.join(', ')}` : c.message);
  const chosen = failed ?? checks[0];
  return { valid: !failed, message: clip(scrub(chosen ? message(chosen) : 'Saved.', secrets), MESSAGE_MAX) };
}

/**
 * The manifest and a handler per operation, derived from `service`. Steps and networks
 * are read once, here; a description the manifest cannot carry throws, so the adapter
 * does not start (fail closed).
 */
export function deriveControlCenter(service: ConfigurationService, identity: ControlCenterIdentity): {
  manifest: ControlCenterManifest;
  operations: Record<string, ControlCenterOperationHandler>;
} {
  const timeoutMs = identity.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const steps = service.steps();
  if (steps.length > MAX_STEPS) throw new Error(`configuration: more than ${MAX_STEPS} steps`);
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) throw new Error(`configuration step ${step.id}: declared twice`);
    seen.add(step.id);
  }

  const operations: Record<string, ControlCenterOperationHandler> = {};
  const specs: Record<string, ControlCenterOperationSpec> = {};

  for (const step of steps) {
    const op = saveOperation(step.id);
    specs[op] = stepSpec(step, timeoutMs);
    operations[op] = async ({ input }) => {
      // the schema admits only strings and integers; the service takes strings (an integer as its decimal string)
      const values = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, String(v)]));
      const result = await service.saveStep(step.id, values);
      if ('refused' in result) throw refuse('INVALID_CONFIG', { status: 422, ...(result.input ? { field: `/${result.input}` } : {}) });
      return saveAnswer(result.checks, await service.sealedValues());
    };
  }

  specs[ACTIVATE_OPERATION] = {
    request: noInput,
    response: object({ version: { type: 'integer' }, appliedAt: { type: 'string', maxLength: 64 } }, ['version', 'appliedAt']),
    secretFields: [],
    idempotency: 'none',
    limits: { maxBodyBytes: 1024, maxResponseBytes: 1024, timeoutMs },
  };
  operations[ACTIVATE_OPERATION] = async () => {
    const outcome = await service.apply();
    if (outcome.ok) return { version: outcome.applied.version, appliedAt: outcome.applied.appliedAt };
    if (outcome.problems.some((p) => p.kind === 'activation')) throw refuse('APPLY_FAILED', { status: 422, retryable: true });
    throw refuse('CONFIG_INCOMPLETE', { status: 409 });
  };

  const detail = object({
    id: { type: 'string', maxLength: DETAIL_ID_MAX },
    label: { type: 'string', maxLength: LABEL_MAX },
    value: { type: 'string', maxLength: VALUE_MAX },
  }, ['id', 'label', 'value']);
  specs[STATUS_OPERATION] = {
    request: noInput,
    response: object({
      state: { type: 'string', enum: Object.values(CONTROL_CENTER_STATE), maxLength: 32 },
      details: { type: 'array', items: detail, maxItems: DETAILS_MAX },
    }, ['state', 'details']),
    secretFields: [],
    idempotency: 'none',
    limits: { maxBodyBytes: 1024, maxResponseBytes: 32 * 1024, timeoutMs },
  };
  operations[STATUS_OPERATION] = async () => {
    const [status, summary, secrets] = await Promise.all([service.status(), service.summary(), service.sealedValues()]);
    const item = (id: string, label: string, value: string) => ({
      id: clip(id, DETAIL_ID_MAX), label: clip(scrub(label, secrets), LABEL_MAX), value: clip(scrub(value, secrets), VALUE_MAX),
    });
    const problem = status.error ? [item('problem', 'Problem', status.error)] : [];
    const details = [...summary.slice(0, DETAILS_MAX - problem.length).map((s) => item(s.id, s.label, s.value)), ...problem];
    return { state: CONTROL_CENTER_STATE[status.state] ?? CONTROL_CENTER_STATE.failed, details };
  };

  const manifest = checkManifest({
    manifestVersion: 1,
    wizardId: identity.wizardId,
    adapter: identity.adapter,
    compatibility: { hostContract: HOST_CONTRACT },
    targets: { network: service.networks() },
    flows: {
      [CONFIGURE_FLOW]: { title: 'Configure', scope: 'integration', operations: [...steps.map((s) => saveOperation(s.id)), ACTIVATE_OPERATION] },
    },
    status: { operation: STATUS_OPERATION },
    operations: specs,
  });
  return { manifest, operations };
}
