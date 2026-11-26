// Control Center's manifest and operations, derived from the adapter's neutral description
// (steps, networks, summary, status, apply). Adapters never write a manifest: this is the
// only place that knows Control Center's flows, operation names, codes and status words.
//
//   flow `configure` (integration): get-fields (when the service has inputsSet), save-<stepId>
//                                    for each step in order, then activate
//   get-fields     {}                    -> { steps: { <stepId>: { set: [<wire id>] } } }  inputsSet, ids only
//   save-<stepId>  { <inputId>: value }  -> { valid, message }   saveStep, then its checks
//   activate       {}                    -> { version, appliedAt } apply
//   get-status     {}                    -> { integration: { state, details }, networks: [{ id, state }] }
import { scrub } from '../scrub';
import {
  ConfigSummaryItem, ConfigurationInput, ConfigurationService, ConfigurationStep, ConfigState, StepCheck,
} from '../service';
import { JsonObject } from './json';
import { checkManifest } from './manifest';
import { isSafePattern } from './pattern-safety';
import { STATUS_DETAIL_LIMIT, statusFault } from './status-fault';
import {
  ControlCenterManifest, ControlCenterOperationHandler, ControlCenterOperationSpec, ControlCenterRefusal, ControlCenterSchema, HOST_CONTRACT, ID_PATTERN,
} from './types';

export interface ControlCenterIdentity {
  /** Control Center's id for this adapter's wizard: lowercase letters, digits and dashes. */
  wizardId: string;
  adapter: { kind: string; name: string; version: string };
  /** Declared per operation; must cover every check a step runs. Default and Control Center's ceiling: 30 s. */
  timeoutMs?: number;
}

export const STATUS_OPERATION = 'get-status';
export const FIELDS_OPERATION = 'get-fields';
export const ACTIVATE_OPERATION = 'activate';
export const CONFIGURE_FLOW = 'configure';
export const saveOperation = (stepId: string): string => `save-${stepId}`;

export const DEFAULT_TIMEOUT_MS = 30_000;
export const STRING_MAX = 4096;
export const URL_MAX = 2048;
export const URL_PATTERN = '^https?://\\S+$';
const HARD_BODY_CAP = 64 * 1024;
const MESSAGE_MAX = 1024;
/** Control Center's status envelope (status-fault.ts): 8 details, labels of 1 to 64 and values of 0 to 128 UTF-16 units. */
const LABEL_MAX = 64;
const VALUE_MAX = 128;
const PROBLEM = { id: 'problem', label: 'Problem' };

/** Control Center's own bounds (ownera-apps AdapterConfig schema.ts), checked here so a manifest it would refuse never starts. */
const MAX_INPUTS = 32;
const MAX_FLOW_OPERATIONS = 32; // Control Center's bound on a flow, activate and get-fields included
const MAX_PATTERN_LENGTH = 256;
const MAX_ANNOTATION_LENGTH = 256;

const STEP_ID = /^[a-z0-9][a-z0-9-]{0,58}$/;

/**
 * The id Control Center sees for an input: every '.' replaced by '_' (ledger.rpcUrl ->
 * ledger_rpcUrl). Control Center's relay keeps a refusal's field only when it matches
 * FIELD_POINTER_PATTERN, ^(\/[A-Za-z0-9_-]{1,64}){1,5}$, which has no dot; the adapter keeps
 * its own ids, and the skeleton maps both ways.
 */
export const wireId = (inputId: string): string => inputId.replace(/\./g, '_');
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

/** Clipped to `max` UTF-16 units (Control Center counts `.length`), never splitting a surrogate pair. */
const clipUnits = (text: string, max: number): string => {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
};

/** A detail id Control Center takes (ID_PATTERN), or undefined when nothing usable is left. */
const detailId = (id: string): string | undefined => {
  if (ID_PATTERN.test(id)) return id;
  const slug = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return ID_PATTERN.test(slug) ? slug : undefined;
};

/**
 * The status details as Control Center takes them: the problem line first, then the summary;
 * ids made to fit ID_PATTERN and unique (an item whose id cannot be is dropped), labels clipped
 * to 1..64, values to 128, scrubbed, and at most 8.
 */
export function statusDetails(summary: ConfigSummaryItem[], error: string | undefined, secrets: string[]): { id: string; label: string; value: string }[] {
  const items = [...(error ? [{ ...PROBLEM, value: error }] : []), ...summary];
  const seen = new Set<string>();
  const details: { id: string; label: string; value: string }[] = [];
  for (const item of items) {
    if (details.length === STATUS_DETAIL_LIMIT) break;
    const id = detailId(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = clipUnits(scrub(item.label, secrets), LABEL_MAX) || id;
    details.push({ id, label, value: clipUnits(scrub(item.value, secrets), VALUE_MAX) });
  }
  return details;
}

const object = (properties: Record<string, ControlCenterSchema>, required: string[] = []): ControlCenterSchema =>
  ({ type: 'object', additionalProperties: false, properties, required });

/**
 * The pattern to put in the manifest, or undefined to leave it to the adapter: Control Center
 * refuses the whole manifest over a pattern longer than 256 or one its isSafePattern refuses
 * (pattern-safety.ts), so such a pattern is left out and `left` records the input. A pattern
 * that does not compile is the adapter's bug and throws.
 */
function manifestPattern(pattern: string, where: string, left: string[]): string | undefined {
  try {
    new RegExp(pattern, 'u'); // eslint-disable-line no-new
  } catch {
    throw new Error(`configuration input ${where}: format.pattern is not a valid regular expression`);
  }
  if (pattern.length > MAX_PATTERN_LENGTH || !isSafePattern(pattern)) {
    left.push(where);
    return undefined;
  }
  return pattern;
}

/** The request schema of one input. Exported for tests. */
export function inputSchema(input: ConfigurationInput, where: string, left: string[] = []): ControlCenterSchema {
  const described = { title: clip(input.label, MAX_ANNOTATION_LENGTH), ...(input.help ? { description: clip(input.help, MAX_ANNOTATION_LENGTH) } : {}) };
  const pattern = input.format ? manifestPattern(input.format.pattern, where, left) : undefined;
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

function stepSpec(step: ConfigurationStep, timeoutMs: number, left: string[], byWire: Map<string, string>): ControlCenterOperationSpec {
  if (!STEP_ID.test(step.id)) throw new Error(`configuration step ${step.id}: the id must be lowercase letters, digits and dashes, 59 at most`);
  if (step.inputs.length > MAX_INPUTS) throw new Error(`configuration step ${step.id}: more than ${MAX_INPUTS} inputs`);
  const properties: Record<string, ControlCenterSchema> = {};
  for (const input of step.inputs) {
    const where = `${step.id}/${input.id}`;
    if (!INPUT_ID.test(input.id)) throw new Error(`configuration input ${where}: the id must be letters, digits, ., _ and -, 64 at most`);
    const wire = wireId(input.id);
    const taken = byWire.get(wire);
    if (taken !== undefined) {
      throw new Error(taken === input.id ? `configuration input ${where}: declared twice` : `configuration input ${where}: Control Center id ${wire} is also ${step.id}/${taken}'s`);
    }
    byWire.set(wire, input.id);
    properties[wire] = inputSchema(input, where, left);
    if (schemaRequired(input) && properties[wire].type === 'string') properties[wire].minLength = 1;
  }
  // JSON can escape a character to 6 bytes; the envelope and keys get a fixed allowance
  const inputBytes = Object.values(properties).reduce((sum, p) => sum + (p.type === 'integer' ? 32 : (p.maxLength ?? STRING_MAX) * 6), 0);
  return {
    request: object(properties, step.inputs.filter(schemaRequired).map((i) => wireId(i.id))),
    response: object({ valid: { type: 'boolean' }, message: { type: 'string', maxLength: MESSAGE_MAX } }, ['valid', 'message']),
    secretFields: step.inputs.filter((i) => i.classification === 'secret').map((i) => `/${wireId(i.id)}`),
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
  /** Inputs (`<stepId>/<inputId>`) whose format.pattern was left out of the manifest; the adapter checks them in saveStep. */
  patternsLeftToAdapter: string[];
} {
  const patternsLeftToAdapter: string[] = [];
  const timeoutMs = identity.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const steps = service.steps();
  const inputsSet = service.inputsSet?.bind(service);
  const maxSteps = MAX_FLOW_OPERATIONS - 1 - (inputsSet ? 1 : 0);
  if (steps.length > maxSteps) throw new Error(`configuration: more than ${maxSteps} steps`);
  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) throw new Error(`configuration step ${step.id}: declared twice`);
    seen.add(step.id);
  }

  const operations: Record<string, ControlCenterOperationHandler> = {};
  const specs: Record<string, ControlCenterOperationSpec> = {};

  for (const step of steps) {
    const op = saveOperation(step.id);
    const byWire = new Map<string, string>();
    specs[op] = stepSpec(step, timeoutMs, patternsLeftToAdapter, byWire);
    operations[op] = async ({ input }) => {
      // keys back to the adapter's input ids; the schema admits only strings and integers, and the
      // service takes strings (an integer as its decimal string)
      const values = Object.fromEntries(Object.entries(input).map(([k, v]) => [byWire.get(k) ?? k, String(v)]));
      const result = await service.saveStep(step.id, values);
      if ('refused' in result) throw refuse('INVALID_CONFIG', { status: 422, ...(result.input ? { field: `/${wireId(result.input)}` } : {}) });
      return saveAnswer(result.checks, await service.sealedValues());
    };
  }

  if (inputsSet) {
    // which inputs hold a stored value, as Control Center's wire ids; never a value
    const wireIds = new Map(steps.map((step) => [step.id, new Map(step.inputs.map((i) => [i.id, wireId(i.id)]))]));
    specs[FIELDS_OPERATION] = {
      request: noInput,
      response: object({
        steps: object(Object.fromEntries(steps.map((step) => {
          const ids = step.inputs.map((i) => wireId(i.id));
          return [step.id, object({
            set: { type: 'array', maxItems: Math.max(1, ids.length), items: { type: 'string', maxLength: 64, ...(ids.length ? { enum: ids } : {}) } },
          }, ['set'])];
        })), steps.map((step) => step.id)),
      }, ['steps']),
      secretFields: [],
      idempotency: 'none',
      limits: { maxBodyBytes: 1024, maxResponseBytes: 32 * 1024, timeoutMs },
    };
    operations[FIELDS_OPERATION] = async () => {
      const stored = await inputsSet();
      return {
        steps: Object.fromEntries(steps.map((step) => {
          const known = wireIds.get(step.id)!;
          // only declared inputs, each once, in the step's order
          const set = new Set((stored[step.id] ?? []).filter((id) => known.has(id)));
          return [step.id, { set: step.inputs.filter((i) => set.has(i.id)).map((i) => known.get(i.id)!) }];
        })),
      };
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

  const networks = service.networks();
  const stateSchema: ControlCenterSchema = { type: 'string', enum: Object.values(CONTROL_CENTER_STATE), maxLength: 32 };
  const detail = object({
    id: { type: 'string', maxLength: 64, pattern: ID_PATTERN.source },
    label: { type: 'string', minLength: 1, maxLength: LABEL_MAX },
    value: { type: 'string', maxLength: VALUE_MAX },
  }, ['id', 'label', 'value']);
  // Control Center's envelope (status-fault.ts). A network carries no details: they would sit at
  // depth 6, past the 5 Control Center's schema compiler takes, and the envelope does not need them.
  specs[STATUS_OPERATION] = {
    request: noInput,
    response: object({
      integration: object({ state: stateSchema, details: { type: 'array', items: detail, maxItems: STATUS_DETAIL_LIMIT } }, ['state', 'details']),
      networks: {
        type: 'array',
        maxItems: Math.max(1, networks.length),
        items: object({
          id: { type: 'string', maxLength: 64, ...(networks.length ? { enum: networks.map((n) => n.id) } : {}) },
          state: stateSchema,
        }, ['id', 'state']),
      },
    }, ['integration', 'networks']),
    secretFields: [],
    idempotency: 'none',
    limits: { maxBodyBytes: 1024, maxResponseBytes: 32 * 1024, timeoutMs },
  };
  const declared = new Set(networks.map((n) => n.id));
  operations[STATUS_OPERATION] = async () => {
    const [status, summary, secrets] = await Promise.all([service.status(), service.summary(), service.sealedValues()]);
    const state = CONTROL_CENTER_STATE[status.state] ?? CONTROL_CENTER_STATE.failed;
    const output = {
      integration: { state, details: statusDetails(summary, status.error, secrets) },
      networks: networks.map((n) => ({ id: n.id, state })),
    };
    // the host checks this envelope besides the declared schema: never send one it would refuse
    const fault = statusFault(output, declared);
    if (fault !== undefined) throw new Error(`status answer outside Control Center's envelope at ${fault}`);
    return output;
  };

  const manifest = checkManifest({
    manifestVersion: 1,
    wizardId: identity.wizardId,
    adapter: identity.adapter,
    compatibility: { hostContract: HOST_CONTRACT },
    targets: { network: networks },
    flows: {
      [CONFIGURE_FLOW]: {
        title: 'Configure',
        scope: 'integration',
        operations: [...(inputsSet ? [FIELDS_OPERATION] : []), ...steps.map((s) => saveOperation(s.id)), ACTIVATE_OPERATION],
      },
    },
    status: { operation: STATUS_OPERATION },
    operations: specs,
  });
  return { manifest, operations, patternsLeftToAdapter };
}
