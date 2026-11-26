// An in-memory ConfigurationService, the way an adapter's engine would answer. Generic on purpose:
// one custody step and one tuning step, nothing named after a real integration.
import {
  ConfigApplyOutcome, ConfigAppliedVersion, ConfigCheckRun, ConfigStatus, ConfigSummaryItem, ConfigurationService, ConfigurationStep, StepCheck, StepSaveResult,
} from '../../../src/config';

export const SECRET = 'sk_live_0123456789';

export const STEPS: ConfigurationStep[] = [
  {
    id: 'custody',
    title: 'Custody',
    description: 'Where keys are held.',
    inputs: [
      { id: 'url', label: 'Custody URL', type: 'url', classification: 'public', required: true },
      { id: 'apiKey', label: 'API key', type: 'string', classification: 'secret', required: true },
      { id: 'custody.region', label: 'Region', type: 'string', classification: 'public', format: { pattern: '^[a-z]{2}-[a-z]+$', message: 'like eu-west' } },
    ],
  },
  {
    id: 'tuning',
    title: 'Tuning',
    inputs: [
      { id: 'mode', label: 'Mode', type: 'enum', classification: 'public', required: true, options: [{ value: 'fast', label: 'Fast' }, { value: 'safe', label: 'Safe' }] },
      { id: 'retries', label: 'Retries', type: 'integer', classification: 'public' },
      { id: 'owner', label: 'Owner', type: 'address', classification: 'confidential' },
    ],
  },
];

export class MemoryConfigurationService implements ConfigurationService {
  values: Record<string, string> = {};

  applied: ConfigAppliedVersion | undefined;

  state: ConfigStatus['state'] = 'unconfigured';

  error: string | undefined;

  /** Fields whose values are secrets: masked in the view, returned by sealedValues(). */
  secretFields = new Set(['custody.apiKey']);

  /** The next apply's problems; empty = it applies. */
  problems: { kind: string; ref: string; message: string }[] = [];

  /** Every saveStep call, as the service received it. */
  saves: { stepId: string; input: Record<string, string> }[] = [];

  summaryItems: ConfigSummaryItem[] = [{ id: 'url', label: 'Custody', value: 'not set' }];

  schema() { return { groups: [{ id: 'custody', fields: ['custody.url', 'custody.apiKey'] }] }; }

  view() {
    return { values: Object.fromEntries(Object.entries(this.values).map(([id, v]) => [id, this.secretFields.has(id) ? { sealed: true } : v])) };
  }

  async write(values: Record<string, string | null>): Promise<Record<string, string>> {
    const refused: Record<string, string> = {};
    for (const [id, v] of Object.entries(values)) {
      if (!id.startsWith('custody.') && !id.startsWith('tuning.')) refused[id] = 'No such field.';
      else if (id === 'custody.url' && v !== null && !/^https?:\/\//.test(v)) refused[id] = `Not a URL: ${v}`;
    }
    if (Object.keys(refused).length) return refused;
    for (const [id, v] of Object.entries(values)) {
      if (v === null) delete this.values[id]; else this.values[id] = v;
    }
    return {};
  }

  async check(refId: string, scope: 'field' | 'group'): Promise<ConfigCheckRun> {
    if (scope === 'field' && refId === 'custody.url') {
      if (!this.values['custody.url']) return { kind: 'missing', missing: ['custody.url'] };
      // a check that echoes the secret it used, as a careless validator might
      return {
        kind: 'ran',
        record: {
          status: 'invalid',
          message: `refused with key ${this.values['custody.apiKey'] ?? '-'}`,
          details: [{ label: 'key', value: this.values['custody.apiKey'] ?? '-' }],
          checkedAt: '2026-11-25T00:00:00Z',
        },
      };
    }
    if (scope === 'group' && refId === 'legacy') return { kind: 'inactive' };
    return { kind: 'unknown' };
  }

  async apply(): Promise<ConfigApplyOutcome> {
    if (this.problems.length) return { ok: false, problems: this.problems };
    this.applied = { version: (this.applied?.version ?? 0) + 1, appliedAt: '2026-11-25T00:00:00Z' };
    this.state = 'active';
    return { ok: true, applied: this.applied };
  }

  status(): ConfigStatus {
    return { state: this.state, ...(this.error ? { error: this.error } : {}), applied: this.applied };
  }

  async sealedValues() {
    return [...this.secretFields].map((id) => this.values[id]).filter((v): v is string => !!v);
  }

  steps() { return STEPS; }

  networks() { return [{ id: 'eip155:31337', label: 'Anvil' }]; }

  async summary() { return this.summaryItems; }

  /** Input ids with a stored value, by step: custody's from the custody.* fields, tuning's from tuning.*; plus ids no step declares. */
  async inputsSet() {
    const has = (field: string) => this.values[field] !== undefined;
    return {
      custody: [...(has('custody.url') ? ['url'] : []), ...(has('custody.apiKey') ? ['apiKey', 'apiKey'] : []), ...(has('custody.region') ? ['custody.region'] : []), 'undeclared'],
      tuning: Object.keys(this.values).filter((f) => f.startsWith('tuning.')).map((f) => f.slice('tuning.'.length)),
      nope: ['x'],
    };
  }

  /** Every runAction call, as the service received it. */
  actions: { ref: string; input: Record<string, unknown> }[] = [];

  /** `register-account`: done, echoing the stored key in its message and a detail; refused without a name. */
  async runAction(ref: string, input: Record<string, unknown>) {
    this.actions.push({ ref, input });
    if (ref !== 'register-account') throw new Error(`no such action ${ref}`);
    if (!input.name) return { status: 'refused' as const, message: 'A name is required.' };
    return {
      status: 'done' as const,
      message: `registered with key ${this.values['custody.apiKey'] ?? '-'}`,
      details: [{ label: 'Key', value: this.values['custody.apiKey'] ?? '-' }],
      applied: { account: String(input.name) },
    };
  }

  /**
   * custody: stores url, apiKey (empty keeps the stored one) and region, then checks the
   * custody: refuses a url on refused.example with the input, a region 'zz-refused' without
   * one; the check is missing without a key, invalid on a url with "bad" (echoing the key).
   */
  async saveStep(stepId: string, input: Record<string, string>): Promise<StepSaveResult> {
    this.saves.push({ stepId, input });
    if (stepId === 'custody') {
      if (input.url?.includes('refused.example')) return { refused: 'invalid-input', input: 'url', reason: `refused ${input.url}` };
      if (input['custody.region'] === 'zz-refused') return { refused: 'invalid-input', input: 'custody.region', reason: 'region' };
      if (input['custody.region'] === 'zz-derived') return { refused: 'invalid-input', reason: 'a derived field refused it' };
      await this.write({
        'custody.url': input.url,
        ...(input.apiKey ? { 'custody.apiKey': input.apiKey } : {}),
        ...(input['custody.region'] !== undefined ? { 'custody.region': input['custody.region'] } : {}),
      });
      const checks: StepCheck[] = !this.values['custody.apiKey']
        ? [{ ref: 'custody.url', status: 'missing', missing: ['custody.apiKey'] }]
        : [{ ref: 'custody.url', ...(input.url.includes('bad')
          ? { status: 'invalid' as const, message: `refused with key ${this.values['custody.apiKey']}` }
          : { status: 'valid' as const, message: 'Connected.' }) }];
      return { saved: true, checks };
    }
    if (stepId === 'tuning') {
      await this.write(Object.fromEntries(Object.entries(input).map(([k, v]) => [`tuning.${k}`, v])));
      return { saved: true, checks: [] };
    }
    throw new Error(`no such step ${stepId}`);
  }
}
