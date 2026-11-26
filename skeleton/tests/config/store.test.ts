import { ConfigSchema, ConfigStore, MemoryConfigBackend, check, fingerprint, invalid, valid } from '../../src/config';

const SCHEMA: ConfigSchema = {
  schemaVersion: 1,
  component: 'test-adapter',
  groups: [
    {
      id: 'custody',
      title: 'Custody',
      description: 'Where keys are held.',
      critical: true,
      fields: [
        { id: 'custody.url', env: 'CUSTODY_URL', label: 'Custody URL', type: 'url', classification: 'public', treatment: 'stored', required: true, format: { pattern: '^https?://', message: 'Expected a URL.' } },
        { id: 'custody.apiKey', env: 'CUSTODY_API_KEY', label: 'API key', type: 'string', classification: 'secret', treatment: 'sealed', required: true },
        { id: 'custody.mode', label: 'Mode', type: 'enum', classification: 'public', treatment: 'stored', required: false, default: 'fast', options: [{ value: 'fast', label: 'Fast' }, { value: 'safe', label: 'Safe' }] },
      ],
      validation: check('custody', 'group', ['custody.url', 'custody.apiKey'], 'Connects to the custodian.'),
    },
  ],
};

const SECRET = 'sk_live_0123456789';

async function filled() {
  const backend = new MemoryConfigBackend();
  const store = await ConfigStore.open(SCHEMA, backend);
  expect(await store.write({ 'custody.url': ' https://custody.example ', 'custody.apiKey': SECRET })).toEqual({});
  return { backend, store };
}

describe('the configuration store', () => {
  it('shows a secret only as sealed with its fingerprint, and keeps a plain value trimmed', async () => {
    const { store } = await filled();
    const view = store.view();
    expect(view.values).toEqual({ 'custody.url': 'https://custody.example', 'custody.apiKey': { sealed: true, fingerprint: fingerprint(SECRET) } });
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(fingerprint(SECRET)).toMatch(/^SHA256:[0-9a-f]{16}$/);
  });

  it('refuses a write with an unknown field, a bad format or an option not offered, and writes none of it', async () => {
    const { store, backend } = await filled();
    expect(await store.write({ 'custody.url': 'ftp://x', 'custody.mode': 'slow', nope: 'x' })).toEqual({
      'custody.url': 'Expected a URL.',
      'custody.mode': 'Expected one of: fast, safe.',
      nope: 'Unknown field.',
    });
    expect(backend.values.get('custody.url')).toBe('https://custody.example');
  });

  it('clears a field with null or an empty string', async () => {
    const { store, backend } = await filled();
    expect(await store.write({ 'custody.apiKey': null })).toEqual({});
    expect(store.view().values['custody.apiKey']).toBeUndefined();
    expect(backend.values.has('custody.apiKey')).toBe(false);
  });

  it('applies only once nothing is missing and the checks passed on these values', async () => {
    const { store } = await filled();
    expect(await store.apply()).toEqual({ ok: false, problems: [{ kind: 'unvalidated', ref: 'custody', message: 'custody has not been checked.' }] });
    const ref = store.findValidation('custody', 'group')!;
    store.record(ref, invalid('refused'));
    expect(await store.apply()).toMatchObject({ ok: false, problems: [{ kind: 'invalid', ref: 'custody' }] });
    store.record(ref, valid('Connected.'));
    await store.write({ 'custody.url': 'https://other.example' });
    expect(await store.apply()).toMatchObject({ ok: false, problems: [{ kind: 'stale', ref: 'custody' }] });
    store.record(ref, valid('Connected.'));
    expect(await store.apply()).toMatchObject({ ok: true, applied: { version: 1 } });
  });

  it('keeps the applied version only, with the values it was applied with, and hands them on by field id and by environment', async () => {
    const { store, backend } = await filled();
    store.record(store.findValidation('custody', 'group')!, valid('Connected.'));
    const seen: Record<string, string>[] = [];
    expect(await store.apply(async (environment) => { seen.push(environment); })).toMatchObject({ ok: true, applied: { version: 1 } });
    expect(seen).toEqual([{ CUSTODY_URL: 'https://custody.example', CUSTODY_API_KEY: SECRET }]);
    await store.write({ 'custody.apiKey': 'sk_live_rotated' });
    store.record(store.findValidation('custody', 'group')!, valid('Connected.'));
    expect(await store.apply()).toMatchObject({ ok: true, applied: { version: 2 } });
    expect(backend.applied).toMatchObject({ version: 2, fieldValues: { 'custody.apiKey': 'sk_live_rotated', 'custody.mode': 'fast' } });
    expect(JSON.stringify(backend.applied)).not.toContain(SECRET);
    expect(store.appliedFieldValues()['custody.apiKey']).toBe('sk_live_rotated');
  });

  it('keeps the previous version applied when the adapter does not start on the new one', async () => {
    const { store } = await filled();
    store.record(store.findValidation('custody', 'group')!, valid('Connected.'));
    expect(await store.apply(async () => { throw new Error('login refused'); })).toEqual({ ok: false, problems: [{ kind: 'activation', ref: 'apply', message: 'login refused' }] });
    expect(store.appliedVersion()).toBeUndefined();
  });

  it('reopens what the backend kept, a secret as its fingerprint only, and skips a field the schema no longer has', async () => {
    const { backend, store } = await filled();
    store.record(store.findValidation('custody', 'group')!, valid('Connected.'));
    await store.apply();
    backend.values.set('legacy.field', 'x');
    const reopened = await ConfigStore.open(SCHEMA, backend);
    expect(reopened.view().values).toEqual({ 'custody.url': 'https://custody.example', 'custody.apiKey': { sealed: true, fingerprint: fingerprint(SECRET) } });
    expect(reopened.appliedVersion()).toMatchObject({ version: 1 });
    expect(await reopened.sealedValues()).toEqual([SECRET]);
    expect((await reopened.resolved())['custody.apiKey']).toBe(SECRET);
  });
});
