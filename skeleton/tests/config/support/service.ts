// An in-memory ConfigurationService, the way an adapter's engine would answer.
import { ConfigApplyOutcome, ConfigAppliedVersion, ConfigCheckRun, ConfigurationService } from '../../../src/config';

export const SECRET = 'sk_live_0123456789';

export class MemoryConfigurationService implements ConfigurationService {
  values: Record<string, string> = {};

  applied: ConfigAppliedVersion | undefined;

  /** Fields whose values are secrets: masked in the view, returned by sealedValues(). */
  secretFields = new Set(['custody.apiKey']);

  /** The next apply's problems; empty = it applies. */
  problems: { kind: string; ref: string; message: string }[] = [];

  schema() { return { groups: [{ id: 'custody', fields: ['custody.url', 'custody.apiKey'] }] }; }

  view() {
    return { values: Object.fromEntries(Object.entries(this.values).map(([id, v]) => [id, this.secretFields.has(id) ? { sealed: true } : v])) };
  }

  async write(values: Record<string, string | null>): Promise<Record<string, string>> {
    const refused: Record<string, string> = {};
    for (const [id, v] of Object.entries(values)) {
      if (!id.startsWith('custody.')) refused[id] = 'No such field.';
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
    return { ok: true, applied: this.applied };
  }

  status() { return { state: this.applied ? 'active' : 'unconfigured', applied: this.applied }; }

  async sealedValues() {
    return [...this.secretFields].map((id) => this.values[id]).filter((v): v is string => !!v);
  }
}
