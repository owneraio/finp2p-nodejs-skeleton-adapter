// Control Center's manifest and operation handlers, derived from a ConfigurationService:
//
//   flow configure: get-values (with inputValues), save-<stepId> per step, activate
//   get-values     {}         -> { steps: { <stepId>: { values: { <wire id>: value }, secrets: { <wire id>: set | not_set } } } }
//   save-<stepId>  { <wire id> } -> { valid, message, details? }
//   activate       {}         -> { version, appliedAt }
//   get-status     {}         -> { integration: { state, details }, networks: [{ id, state }] }
//
// Control Center refuses a whole manifest over any excess (ownera-apps AdapterConfig manifest.ts,
// schema.ts, status.ts), so its bounds are mirrored here and checked at registration.
import { scrub } from '../scrub';
import {
  ConfigSummaryItem, ConfigurationInput, ConfigurationService, ConfigurationStep, ConfigState, StepCheck,
} from '../service';
import { isSafePattern } from './pattern-safety';
import {
  ControlCenterManifest, ControlCenterOperationHandler, ControlCenterOperationSpec, ControlCenterRefusal, ControlCenterSchema,
  HOST_CONTRACT, ID_PATTERN, NETWORK_ID_PATTERN,
} from './types';

export interface ControlCenterIdentity {
  wizardId: string;
  adapter: { kind: string; name: string; version: string };
  /** Per operation, 100 ms to 30 s (Control Center's ceiling). It must cover all the checks a save runs. */
  timeoutMs?: number;
}

const STATUS_OPERATION = 'get-status';
const VALUES_OPERATION = 'get-values';
const ACTIVATE_OPERATION = 'activate';
const saveOperation = (stepId: string): string => `save-${stepId}`;

export const URL_PATTERN = '^https?://\\S+$';
const STRING_MAX = 4096;
const URL_MAX = 2048;
const INTEGER_MAX = 32;
const MESSAGE_MAX = 1024;
const LABEL_MAX = 64;
const VALUE_MAX = 128;
const STATUS_DETAILS_MAX = 8;
const CHECK_DETAILS_MAX = 32;
const BODY_CAP = 64 * 1024;

// Control Center's bounds
const MAX_FLOW_OPERATIONS = 32;
const MAX_INPUTS = 32;
const MAX_NETWORKS = 50;
const MAX_PATTERN_LENGTH = 256;
const MAX_ANNOTATION_LENGTH = 256;
const TIMEOUT_RANGE = [100, 30_000];
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

const STEP_ID = /^[a-z0-9][a-z0-9-]{0,58}$/;
const INPUT_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Control Center's refusal pointers allow no dot, so it sees input ids with every '.' as '_'. */
export const wireId = (inputId: string): string => inputId.replace(/\./g, '_');

const STATE: Record<ConfigState, string> = { unconfigured: 'not_configured', active: 'active', failed: 'needs_attention' };

const refuse = (code: string, extra: Omit<ControlCenterRefusal, 'code'> = {}): Error & ControlCenterRefusal =>
  Object.assign(new Error(code), { code, ...extra });

/** Clipped to `max` UTF-16 units, as Control Center counts, without splitting a surrogate pair. */
const clip = (text: string, max: number): string => {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
};

const text = (value: unknown, max: number): boolean => typeof value === 'string' && value.length > 0 && value.length <= max;

const object = (properties: Record<string, ControlCenterSchema>, required: string[] = []): ControlCenterSchema =>
  ({ type: 'object', additionalProperties: false, properties, required });

const noInput = object({});

type Row = { label: string; value: string };

const rowSchema = object({ label: { type: 'string', minLength: 1, maxLength: LABEL_MAX }, value: { type: 'string', maxLength: VALUE_MAX } }, ['label', 'value']);

function checkIdentity({ wizardId, adapter }: ControlCenterIdentity): void {
  if (!ID_PATTERN.test(wizardId)) throw new Error('Control Center wizardId: lowercase letters, digits and dashes');
  if (!ID_PATTERN.test(adapter.kind)) throw new Error('Control Center adapter.kind: lowercase letters, digits and dashes');
  if (!text(adapter.name, 128)) throw new Error('Control Center adapter.name: 1 to 128 characters');
  if (!VERSION_PATTERN.test(adapter.version)) throw new Error(`Control Center adapter.version: must match ${VERSION_PATTERN.source}`);
}

function checkNetworks(networks: { id: string; label: string }[]): void {
  if (networks.length > MAX_NETWORKS) throw new Error(`Control Center networks: ${MAX_NETWORKS} at most`);
  for (const n of networks) {
    if (!NETWORK_ID_PATTERN.test(n.id)) throw new Error(`Control Center network ${n.id}: not a CAIP-2 id`);
    if (!text(n.label, 128)) throw new Error(`Control Center network ${n.id}: label of 1 to 128 characters`);
  }
  if (new Set(networks.map((n) => n.id)).size !== networks.length) throw new Error('Control Center networks: declared twice');
}

/** A pattern Control Center would refuse is left out (and recorded in `left`); one that does not compile throws. */
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

function inputSchema(input: ConfigurationInput, where: string, left: string[]): ControlCenterSchema {
  const described = { title: clip(input.label, MAX_ANNOTATION_LENGTH), ...(input.help ? { description: clip(input.help, MAX_ANNOTATION_LENGTH) } : {}) };
  const pattern = input.format ? manifestPattern(input.format.pattern, where, left) : undefined;
  switch (input.type) {
    case 'integer':
      return { type: 'integer', ...described };
    case 'enum': {
      const values = (input.options ?? []).map((o) => o.value);
      if (!values.length) throw new Error(`configuration input ${where}: an enum needs options`);
      return { type: 'string', enum: values, maxLength: Math.max(...values.map((v) => v.length)), ...described };
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

// an empty secret keeps the stored one, so a secret is never required
const schemaRequired = (input: ConfigurationInput): boolean => input.required === true && input.classification !== 'secret';

function stepSpec(step: ConfigurationStep, timeoutMs: number, left: string[], byWire: Map<string, string>): ControlCenterOperationSpec {
  if (!STEP_ID.test(step.id)) throw new Error(`configuration step ${step.id}: lowercase letters, digits and dashes, 59 at most`);
  if (step.inputs.length > MAX_INPUTS) throw new Error(`configuration step ${step.id}: more than ${MAX_INPUTS} inputs`);
  const properties: Record<string, ControlCenterSchema> = {};
  for (const input of step.inputs) {
    const where = `${step.id}/${input.id}`;
    if (!INPUT_ID.test(input.id)) throw new Error(`configuration input ${where}: letters, digits, ., _ and -, 64 at most`);
    const wire = wireId(input.id);
    const taken = byWire.get(wire);
    if (taken !== undefined) {
      throw new Error(taken === input.id ? `configuration input ${where}: declared twice` : `configuration input ${where}: Control Center id ${wire} is also ${step.id}/${taken}'s`);
    }
    byWire.set(wire, input.id);
    properties[wire] = inputSchema(input, where, left);
    if (schemaRequired(input) && properties[wire].type === 'string') properties[wire].minLength = 1;
  }
  // a JSON escape takes up to 6 bytes per character
  const inputBytes = Object.values(properties).reduce((sum, p) => sum + (p.type === 'integer' ? INTEGER_MAX : (p.maxLength ?? STRING_MAX) * 6), 0);
  return {
    request: object(properties, step.inputs.filter(schemaRequired).map((i) => wireId(i.id))),
    response: object({
      valid: { type: 'boolean' },
      message: { type: 'string', maxLength: MESSAGE_MAX },
      details: { type: 'array', maxItems: CHECK_DETAILS_MAX, items: rowSchema },
    }, ['valid', 'message']),
    secretFields: step.inputs.filter((i) => i.classification === 'secret').map((i) => `/${wireId(i.id)}`),
    idempotency: 'none',
    limits: { maxBodyBytes: Math.min(BODY_CAP, 1024 + 128 * step.inputs.length + inputBytes), maxResponseBytes: 64 * 1024, timeoutMs },
  };
}

const rows = (items: Row[], secrets: string[]): Row[] => items.slice(0, CHECK_DETAILS_MAX).map((r) => ({
  label: clip(scrub(r.label, secrets), LABEL_MAX) || '-',
  value: clip(scrub(r.value, secrets), VALUE_MAX),
}));

/** The first check that failed or could not run, with its details; else every check's details. */
function saveAnswer(checks: StepCheck[], secrets: string[]): { valid: boolean; message: string; details?: Row[] } {
  const failed = checks.find((c) => c.status !== 'valid');
  const message = (c: StepCheck): string => (c.status === 'missing' ? `Missing: ${c.missing.join(', ')}` : c.message);
  const rowsOf = (c: StepCheck): Row[] => (c.status === 'missing' ? [] : c.details ?? []);
  const chosen = failed ?? checks[0];
  const details = rows(failed ? rowsOf(failed) : checks.flatMap(rowsOf), secrets);
  return {
    valid: !failed,
    message: clip(scrub(chosen ? message(chosen) : 'Saved.', secrets), MESSAGE_MAX),
    ...(details.length ? { details } : {}),
  };
}

/** A detail id Control Center takes, slugged if needed; undefined when none can be made. */
const detailId = (id: string): string | undefined => {
  if (ID_PATTERN.test(id)) return id;
  const slug = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return ID_PATTERN.test(slug) ? slug : undefined;
};

/** Status details as Control Center's envelope takes them: the problem first, then the summary; 8 at most, ids unique. */
export function statusDetails(summary: ConfigSummaryItem[], error: string | undefined, secrets: string[]): (Row & { id: string })[] {
  const items = [...(error ? [{ id: 'problem', label: 'Problem', value: error }] : []), ...summary];
  const seen = new Set<string>();
  const details: (Row & { id: string })[] = [];
  for (const item of items) {
    if (details.length === STATUS_DETAILS_MAX) break;
    const id = detailId(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    details.push({ id, label: clip(scrub(item.label, secrets), LABEL_MAX) || id, value: clip(scrub(item.value, secrets), VALUE_MAX) });
  }
  return details;
}

/**
 * The manifest and its handlers. Steps and networks are read once, here; anything Control Center
 * would refuse throws, except a format.pattern, which is left to the adapter's saveStep.
 */
export function deriveControlCenter(service: ConfigurationService, identity: ControlCenterIdentity): {
  manifest: ControlCenterManifest;
  operations: Record<string, ControlCenterOperationHandler>;
  /** `<stepId>/<inputId>` of each format.pattern left out of the manifest. */
  patternsLeftToAdapter: string[];
} {
  checkIdentity(identity);
  const timeoutMs = identity.timeoutMs ?? TIMEOUT_RANGE[1];
  if (!Number.isInteger(timeoutMs) || timeoutMs < TIMEOUT_RANGE[0] || timeoutMs > TIMEOUT_RANGE[1]) {
    throw new Error(`Control Center timeoutMs: ${TIMEOUT_RANGE[0]} to ${TIMEOUT_RANGE[1]}`);
  }
  const networks = service.networks();
  checkNetworks(networks);
  const steps = service.steps();
  const withValues = typeof service.inputValues === 'function';
  const maxSteps = MAX_FLOW_OPERATIONS - 1 - (withValues ? 1 : 0);
  if (steps.length > maxSteps) throw new Error(`configuration: more than ${maxSteps} steps`);
  if (new Set(steps.map((s) => s.id)).size !== steps.length) throw new Error('configuration: a step declared twice');

  const patternsLeftToAdapter: string[] = [];
  const specs: Record<string, ControlCenterOperationSpec> = {};
  const operations: Record<string, ControlCenterOperationHandler> = {};
  const spec = (request: ControlCenterSchema, response: ControlCenterSchema, maxResponseBytes: number): ControlCenterOperationSpec =>
    ({ request, response, secretFields: [], idempotency: 'none', limits: { maxBodyBytes: 1024, maxResponseBytes, timeoutMs } });

  for (const step of steps) {
    const op = saveOperation(step.id);
    const byWire = new Map<string, string>();
    specs[op] = stepSpec(step, timeoutMs, patternsLeftToAdapter, byWire);
    operations[op] = async (input) => {
      // back to the adapter's ids, every value a string (an integer as its decimal string)
      const values = Object.fromEntries(Object.entries(input).map(([k, v]) => [byWire.get(k) ?? k, String(v)]));
      const result = await service.saveStep(step.id, values);
      if ('refused' in result) throw refuse('INVALID_CONFIG', { status: 422, ...(result.input ? { field: `/${wireId(result.input)}` } : {}) });
      return saveAnswer(result.checks, await service.sealedValues());
    };
  }

  if (withValues) {
    const shapes = steps.map((step) => {
      const request = specs[saveOperation(step.id)].request.properties ?? {};
      const of = (secret: boolean) => step.inputs.filter((i) => (i.classification === 'secret') === secret).map((i) => {
        const wire = wireId(i.id);
        return { id: i.id, wire, max: request[wire].type === 'integer' ? INTEGER_MAX : request[wire].maxLength ?? STRING_MAX };
      });
      return { step, regular: of(false), secret: of(true) };
    });
    specs[VALUES_OPERATION] = spec(noInput, object({
      steps: object(Object.fromEntries(shapes.map(({ step, regular, secret }) => [step.id, object({
        values: object(Object.fromEntries(regular.map((r) => [r.wire, { type: 'string', maxLength: r.max } as ControlCenterSchema]))),
        secrets: object(
          Object.fromEntries(secret.map((r) => [r.wire, { type: 'string', enum: ['set', 'not_set'], maxLength: 7 } as ControlCenterSchema])),
          secret.map((r) => r.wire),
        ),
      }, ['values', 'secrets'])])), steps.map((step) => step.id)),
    }, ['steps']), 1024 * 1024);
    // a secret goes out only as set or not set, even one handed over in the clear
    operations[VALUES_OPERATION] = async () => {
      const [stored, sealed] = await Promise.all([service.inputValues!(), service.sealedValues()]);
      return {
        steps: Object.fromEntries(shapes.map(({ step, regular, secret }) => {
          const held = stored[step.id] ?? {};
          const values: Record<string, string> = {};
          for (const r of regular) {
            const v = held[r.id];
            if (typeof v === 'string') values[r.wire] = clip(scrub(v, sealed), r.max);
          }
          const secrets = Object.fromEntries(secret.map((r) => [r.wire, held[r.id] !== undefined && held[r.id] !== '' ? 'set' : 'not_set']));
          return [step.id, { values, secrets }];
        })),
      };
    };
  }

  specs[ACTIVATE_OPERATION] = spec(noInput, object({ version: { type: 'integer' }, appliedAt: { type: 'string', maxLength: 64 } }, ['version', 'appliedAt']), 1024);
  operations[ACTIVATE_OPERATION] = async () => {
    const outcome = await service.apply();
    if (outcome.ok) return { version: outcome.applied.version, appliedAt: outcome.applied.appliedAt };
    if (outcome.problems.some((p) => p.kind === 'activation')) throw refuse('APPLY_FAILED', { status: 422, retryable: true });
    throw refuse('CONFIG_INCOMPLETE', { status: 409 });
  };

  // networks carry no details: they would nest past the schema depth of 5 Control Center compiles
  const state: ControlCenterSchema = { type: 'string', enum: Object.values(STATE), maxLength: 32 };
  specs[STATUS_OPERATION] = spec(noInput, object({
    integration: object({
      state,
      details: {
        type: 'array',
        maxItems: STATUS_DETAILS_MAX,
        items: object({ id: { type: 'string', maxLength: 64, pattern: ID_PATTERN.source }, ...rowSchema.properties }, ['id', 'label', 'value']),
      },
    }, ['state', 'details']),
    networks: {
      type: 'array',
      maxItems: Math.max(1, networks.length),
      items: object({ id: { type: 'string', maxLength: 64, ...(networks.length ? { enum: networks.map((n) => n.id) } : {}) }, state }, ['id', 'state']),
    },
  }, ['integration', 'networks']), 32 * 1024);
  operations[STATUS_OPERATION] = async () => {
    const [status, summary, secrets] = await Promise.all([service.status(), service.summary(), service.sealedValues()]);
    const current = STATE[status.state] ?? STATE.failed;
    return {
      integration: { state: current, details: statusDetails(summary, status.error, secrets) },
      networks: networks.map((n) => ({ id: n.id, state: current })),
    };
  };

  const manifest: ControlCenterManifest = {
    manifestVersion: 1,
    wizardId: identity.wizardId,
    adapter: identity.adapter,
    compatibility: { hostContract: HOST_CONTRACT },
    targets: { network: networks },
    flows: {
      configure: {
        title: 'Configure',
        scope: 'integration',
        operations: [...(withValues ? [VALUES_OPERATION] : []), ...steps.map((s) => saveOperation(s.id)), ACTIVATE_OPERATION],
      },
    },
    status: { operation: STATUS_OPERATION },
    operations: specs,
  };
  if (Buffer.byteLength(JSON.stringify(manifest), 'utf8') > 64 * 1024) throw new Error('Control Center manifest: larger than 64 KiB');
  return { manifest, operations, patternsLeftToAdapter };
}
