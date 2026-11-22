import { sealWithPublicKey } from '../../src/config/envelope';
import { accountConfigId, ConfigRuntime, ConfigRequestError, PLAIN_KID } from '../../src/config/runtime';
import {
  pagesOfKind, sanitizeMessage, staticValidate, visibleFields, withDefaults,
} from '../../src/config/schema';
import { ERROR_CODES, SEAL_ALG, SealedValue } from '../../src/config/types';
import {
  account, ADDR, custody, fakeHandler, NET, NET2, net, networkPages, pages, pagesWithAccount, RPC, SECRET, silentLogger, valid, validCustody,
} from './support/fixtures';
import { MemoryStore } from './support/memory-store';
import { TestSealer } from './support/test-sealer';

const adapter = { id: 'test-adapter', kind: '@owneraio/test', version: '0.0.0' };

const newRuntime = (extra: Partial<ConstructorParameters<typeof ConfigRuntime>[0]> = {}) => {
  const handler = extra.handler ?? fakeHandler();
  const rt = new ConfigRuntime({ adapter, pages, handler, logger: silentLogger, ...extra });
  return { rt, handler: handler as ReturnType<typeof fakeHandler> };
};

const stored = (id: string, over: Record<string, unknown> = {}) => ({
  kind: 'network' as const, id, name: id, isDefault: true, version: 1, values: { ...valid }, secrets: {}, ...over,
});

describe('schema', () => {
  test('pagesOfKind splits by page.kind, network when omitted', () => {
    expect(pagesOfKind(pages, 'network').map((p) => p.id)).toEqual(['network', 'keys', 'custody-ref']);
    expect(pagesOfKind(pages, 'custody').map((p) => p.id)).toEqual(['custody']);
  });

  test('withDefaults fills empty and missing values as strings', () => {
    expect(withDefaults(networkPages, { TIMEOUT_MS: '' })).toMatchObject({ PROVIDER: 'rpc', TIMEOUT_MS: '5000', VERBOSE: 'false' });
    expect(withDefaults(networkPages, { TIMEOUT_MS: '7' }).TIMEOUT_MS).toBe('7');
  });

  test('visibleFields follows page and field visibleWhen', () => {
    const rpc = visibleFields(networkPages, withDefaults(networkPages, {})).map((f) => f.name);
    expect(rpc).toContain('RPC_URL');
    expect(rpc).not.toContain('CUSTODY_API_KEY');
    const cust = visibleFields(networkPages, withDefaults(networkPages, { PROVIDER: 'custody' })).map((f) => f.name);
    expect(cust).toContain('CUSTODY_API_KEY');
    expect(cust).not.toContain('RPC_URL');
  });

  test('required only when visible, defaults applied', () => {
    const paths = staticValidate(networkPages, {}).map((e) => e.path);
    expect(paths).toEqual(['RPC_URL', 'OPERATOR_KEY']);
    const cust = staticValidate(networkPages, { PROVIDER: 'custody', OPERATOR_KEY: '0x01' }).map((e) => e.path);
    expect(cust).toEqual(['CUSTODY_API_KEY']);
  });

  test('type, min/max, pattern, enum, unknown field', () => {
    const errors = staticValidate(networkPages, {
      RPC_URL: 'nope', OPERATOR_KEY: 'zz', TIMEOUT_MS: '5', CONTRACT: '0x12', TAG: 'ABC', NOPE: 'x', VERBOSE: 'yes',
    });
    const byPath = Object.fromEntries(errors.map((e) => [e.path, e.code]));
    expect(byPath).toEqual({
      RPC_URL: ERROR_CODES.type,
      OPERATOR_KEY: ERROR_CODES.type,
      TIMEOUT_MS: ERROR_CODES.min,
      CONTRACT: ERROR_CODES.type,
      TAG: ERROR_CODES.pattern,
      NOPE: ERROR_CODES.unknownField,
      VERBOSE: ERROR_CODES.type,
    });
    expect(staticValidate(networkPages, { ...valid, TIMEOUT_MS: '99999' }).map((e) => e.code)).toEqual([ERROR_CODES.max]);
    // a bad enum value hides the rpc page, so RPC_URL is neither required nor checked
    expect(staticValidate(networkPages, { PROVIDER: 'other', OPERATOR_KEY: '0x01' }).map((e) => [e.path, e.code])).toEqual([['PROVIDER', ERROR_CODES.enum]]);
    expect(staticValidate(networkPages, { ...valid, TIMEOUT_MS: 'abc' }).map((e) => e.code)).toEqual([ERROR_CODES.type]);
  });

  test('url must not embed credentials', () => {
    const errors = staticValidate(networkPages, { ...valid, RPC_URL: 'http://alice:pw@rpc.example' });
    expect(errors.map((e) => [e.path, e.code])).toEqual([['RPC_URL', ERROR_CODES.type]]);
    expect(JSON.stringify(errors)).not.toContain('alice');
    expect(staticValidate(networkPages, { ...valid, RPC_URL: 'http://rpc.example' })).toEqual([]);
  });

  test('error messages never carry a value', () => {
    const errors = staticValidate(networkPages, { RPC_URL: 'not-a-url-' + SECRET, OPERATOR_KEY: SECRET, RPC_AUTH: SECRET });
    expect(JSON.stringify(errors)).not.toContain(SECRET);
  });

  test('sanitizeMessage strips url credentials and secrets, longest first', () => {
    expect(sanitizeMessage('http://u:p@host/x failed with abc and abcdef', ['abc', 'abcdef']))
      .toBe('http://host/x failed with [redacted] and [redacted]');
  });
});

describe('ConfigRuntime.refOf', () => {
  test('kinds and ids', () => {
    expect(ConfigRuntime.refOf(undefined, 'eip155:1')).toEqual({ kind: 'network', id: 'eip155:1' });
    expect(ConfigRuntime.refOf('custody', 'fireblocks-sandbox')).toEqual({ kind: 'custody', id: 'fireblocks-sandbox' });
    expect(ConfigRuntime.refOf('network', 'inmemory')).toEqual({ kind: 'network', id: 'inmemory' });
    for (const bad of ['', 'a/b', 'a b', '-x', 'x'.repeat(65), 42, undefined]) {
      expect(() => ConfigRuntime.refOf('network', bad)).toThrow(ConfigRequestError);
    }
    expect(() => ConfigRuntime.refOf('asset', 'x')).toThrow(/kind must be one of/);
    try {
      ConfigRuntime.refOf('network', 'a b');
    } catch (e) {
      expect(e).toMatchObject({ status: 400, code: ERROR_CODES.badId, path: 'id' });
    }
  });
});

describe('ConfigRuntime.merge', () => {
  test('omitted keeps, null and "" clear, scalars stringified', async () => {
    const { rt } = newRuntime();
    const base = stored(NET, { values: { RPC_URL: RPC, TAG: 'x' } });
    const m = await rt.merge('network', { TAG: null, TIMEOUT_MS: 7, VERBOSE: true }, base);
    expect(m.errors).toEqual([]);
    expect(m.values).toEqual({ RPC_URL: RPC, TIMEOUT_MS: '7', VERBOSE: 'true' });
    expect(m.cleared).toEqual(['TAG']);
    const m2 = await rt.merge('network', { RPC_URL: '' }, base);
    expect(m2.values.RPC_URL).toBeUndefined();
  });

  test('fields are scoped by kind: a custody field is unknown on a network config', async () => {
    const { rt } = newRuntime();
    const m = await rt.merge('network', { VENDOR: 'fireblocks' });
    expect(m.errors).toEqual([expect.objectContaining({ path: 'VENDOR', code: ERROR_CODES.unknownField })]);
    const c = await rt.merge('custody', { VENDOR: 'fireblocks', RPC_URL: RPC });
    expect(c.errors).toEqual([expect.objectContaining({ path: 'RPC_URL', code: ERROR_CODES.unknownField })]);
    expect(c.values).toEqual({ VENDOR: 'fireblocks' });
  });

  test('a stored key that is no longer a schema field is ignored and can be cleared', async () => {
    const warns: string[] = [];
    const { rt } = newRuntime({ logger: { ...silentLogger, warn: (m) => { warns.push(m); } } });
    const oldSecret: SealedValue = { enc: SEAL_ALG, kid: PLAIN_KID, wrappedKey: '', iv: '', ciphertext: '' };
    const base = stored(NET, { values: { ...valid, REMOVED_FIELD: 'v' }, secrets: { OLD_SECRET: oldSecret } });
    const m = await rt.merge('network', { TAG: 'ok' }, base);
    expect(m.errors).toEqual([]);
    expect(m.values).toEqual({ ...valid, TAG: 'ok' });
    expect(m.secrets).toEqual({});
    expect(warns).toHaveLength(1);
    const cleared = await rt.merge('network', { REMOVED_FIELD: null, NOPE: '' }, base);
    expect(cleared.errors).toEqual([]);
    expect(cleared.cleared).toEqual(['REMOVED_FIELD', 'NOPE']);
  });

  test('unknown field and non-scalar values are errors: a request carries no sealed value', async () => {
    const { rt } = newRuntime({ sealer: new TestSealer() });
    const sealed: SealedValue = { enc: SEAL_ALG, kid: 'test', wrappedKey: '', iv: '', ciphertext: '' };
    const m = await rt.merge('network', { NOPE: 'x', RPC_URL: sealed as any, OPERATOR_KEY: sealed as any, TAG: { a: 1 } as any });
    expect(m.errors.map((e) => [e.path, e.code])).toEqual([
      ['NOPE', ERROR_CODES.unknownField], ['RPC_URL', ERROR_CODES.type], ['OPERATOR_KEY', ERROR_CODES.type], ['TAG', ERROR_CODES.type],
    ]);
  });

  test('no sealer: plaintext secret is stored under the plain pseudo envelope and opens', async () => {
    const { rt } = newRuntime();
    const m = await rt.merge('network', { OPERATOR_KEY: SECRET });
    expect(m.secrets.OPERATOR_KEY.kid).toBe(PLAIN_KID);
    expect(JSON.stringify(m.secrets)).not.toContain(SECRET);
    expect(m.plainSecrets).toEqual({ OPERATOR_KEY: SECRET });
    expect(await rt.open(m.secrets)).toEqual({ OPERATOR_KEY: SECRET });
  });

  test('sealer: a plaintext secret is sealed now for the store', async () => {
    const sealer = new TestSealer();
    const { rt } = newRuntime({ sealer });
    const m = await rt.merge('network', { OPERATOR_KEY: SECRET });
    expect(m.secrets.OPERATOR_KEY.kid).toBe('test');
    expect(JSON.stringify(m.secrets)).not.toContain(SECRET);
    expect(await rt.open(m.secrets)).toEqual({ OPERATOR_KEY: SECRET });
  });

  test('open: stored with a key this adapter cannot unwrap -> seal-open-failed without the value', async () => {
    const foreign = sealWithPublicKey(await new TestSealer('test').publicKey(), 'test', SECRET);   // same kid, other key
    const store = new MemoryStore();
    await store.save({ kind: 'network', id: NET, name: NET, isDefault: true, values: { RPC_URL: RPC }, secrets: { OPERATOR_KEY: foreign } });
    const { rt } = newRuntime({ sealer: new TestSealer(), store });
    await expect(rt.open({ OPERATOR_KEY: foreign })).rejects.toMatchObject({ status: 422, code: ERROR_CODES.sealOpenFailed, path: 'OPERATOR_KEY' });
    const result = await rt.validate({ id: NET, values: {} });
    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ path: 'OPERATOR_KEY', code: ERROR_CODES.sealOpenFailed })] });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe('ConfigRuntime.validate', () => {
  test('static errors -> no checks run', async () => {
    const { rt, handler } = newRuntime();
    const r = await rt.validate({ values: { RPC_URL: 'bad' } });
    expect(r.ok).toBe(false);
    expect(r.checks).toEqual([]);
    expect(handler.checkCalls).toHaveLength(0);
  });

  test('checks receive the ref, values with defaults and opened secrets; failing check -> ok false', async () => {
    const { rt, handler } = newRuntime();
    const r = await rt.validate({ id: NET, values: { ...valid, RPC_AUTH: SECRET } });
    expect(r).toEqual({ ok: true, errors: [], checks: [{ id: 'rpc', label: 'RPC', ok: true }] });
    expect(handler.checkCalls[0].ref).toEqual(net(NET));
    expect(handler.checkCalls[0].values).toEqual({ PROVIDER: 'rpc', RPC_URL: RPC, TIMEOUT_MS: '5000', VERBOSE: 'false' });
    expect(handler.checkCalls[0].secrets).toEqual({ OPERATOR_KEY: '0xabcdef', RPC_AUTH: SECRET });
    // no id: the handler still learns the kind
    await rt.validate({ kind: 'custody', values: validCustody });
    expect(handler.checkCalls[1].ref).toEqual({ kind: 'custody', id: '' });

    handler.checksResult = [{ id: 'rpc', label: 'RPC', ok: false, message: `auth ${SECRET} rejected` }];
    const failed = await rt.validate({ values: { ...valid, RPC_AUTH: SECRET } });
    expect(failed.ok).toBe(false);
    expect(failed.checks[0].message).toBe('auth [redacted] rejected');
  });

  test('bad kind or id -> 400 ConfigRequestError', async () => {
    const { rt } = newRuntime();
    await expect(rt.validate({ kind: 'nope' as any, values: {} })).rejects.toMatchObject({ status: 400, code: ERROR_CODES.badId });
    await expect(rt.validate({ id: 'a b', values: {} })).rejects.toMatchObject({ status: 400, code: ERROR_CODES.badId });
  });

  test('check timeout -> failed check', async () => {
    const handler = fakeHandler();
    handler.check = () => new Promise(() => {});
    const { rt } = newRuntime({ handler, checkTimeoutMs: 20 });
    const r = await rt.validate({ values: valid });
    expect(r.ok).toBe(false);
    expect(r.checks[0].message).toMatch(/timeout/);
  });

  test('validate with id merges on top of the stored config', async () => {
    const { rt } = newRuntime();
    const applied = await rt.apply({ id: NET, values: valid });
    expect(applied.ok).toBe(true);
    expect((await rt.validate({ id: NET, values: { TAG: 'ok' } })).ok).toBe(true);
    expect((await rt.validate({ values: { TAG: 'ok' } })).ok).toBe(false);
  });
});

describe('ConfigRuntime.apply', () => {
  test('happy path: activate gets defaults + opened secrets, version bumps, store written', async () => {
    const store = new MemoryStore();
    const { rt, handler } = newRuntime({ store });
    const r = await rt.apply({ id: NET, values: { ...valid, RPC_AUTH: SECRET, TIMEOUT_MS: 10000 } }, 'me@test');
    expect(r).toEqual({ ok: true, state: 'configured', version: 1, errors: [], kind: 'network', id: NET, checks: [{ id: 'rpc', label: 'RPC', ok: true }] });
    expect(handler.activated).toHaveLength(1);
    expect(handler.activated[0]).toEqual({
      kind: 'network', id: NET, name: NET, version: 1, isDefault: true,
      values: { PROVIDER: 'rpc', RPC_URL: RPC, TIMEOUT_MS: '10000', VERBOSE: 'false' },
      secrets: { OPERATOR_KEY: '0xabcdef', RPC_AUTH: SECRET },
    });
    expect(rt.resolve(NET)?.id).toBe(NET);
    expect(rt.networks()).toEqual([NET]);
    expect(rt.readiness()).toEqual({ ready: true, blocking: [] });

    const row = store.row(NET)!;
    expect(row.actor).toBe('me@test');
    expect(JSON.stringify(row)).not.toContain(SECRET);

    // update: version 2, old slot deactivated, name kept
    const r2 = await rt.apply({ id: NET, values: { TAG: 'abc' } });
    expect(r2).toMatchObject({ ok: true, version: 2, id: NET });
    expect(handler.deactivated).toEqual([net(NET)]);
    expect(handler.activated[1]).toMatchObject({ version: 2, values: expect.objectContaining({ TAG: 'abc', RPC_URL: RPC }), secrets: { OPERATOR_KEY: '0xabcdef', RPC_AUTH: SECRET } });
  });

  test('bad id -> 400 ConfigRequestError, nothing stored', async () => {
    const store = new MemoryStore();
    const { rt } = newRuntime({ store });
    await expect(rt.apply({ id: 'has space', values: valid })).rejects.toMatchObject({ status: 400, code: ERROR_CODES.badId });
    await expect(rt.apply({ id: undefined as any, values: valid })).rejects.toMatchObject({ status: 400 });
    expect(store.configs.size).toBe(0);
  });

  test('custody kind: own pages, own default, same lifecycle', async () => {
    const store = new MemoryStore();
    const { rt, handler } = newRuntime({ store });
    const r = await rt.apply({ kind: 'custody', id: 'fb', values: validCustody });
    expect(r).toMatchObject({ ok: true, kind: 'custody', id: 'fb', state: 'configured' });
    expect(handler.activated[0]).toMatchObject({ kind: 'custody', id: 'fb', isDefault: true, values: { VENDOR: 'fireblocks' }, secrets: { API_KEY: 'k' } });
    // a custody config alone does not make the adapter ready
    expect(rt.readiness()).toEqual({ ready: false, blocking: ['no network configured yet'] });
    // the first network config is also default: defaults are per kind
    await rt.apply({ id: NET, values: valid });
    expect(rt.defaultOf('custody')?.id).toBe('fb');
    expect(rt.defaultOf('network')?.id).toBe(NET);
    expect(rt.get(custody('fb'))?.kind).toBe('custody');
    expect(rt.get(net('fb'))).toBeUndefined();
    expect(rt.list().map((c) => [c.kind, c.id, c.isDefault])).toEqual([['custody', 'fb', true], ['network', NET, true]]);
  });

  test('failing check -> 422 shaped result, nothing activated or stored', async () => {
    const store = new MemoryStore();
    const { rt, handler } = newRuntime({ store });
    handler.checksResult = [{ id: 'rpc', label: 'RPC', ok: false, message: 'unreachable' }];
    const r = await rt.apply({ id: NET, values: valid });
    expect(r).toMatchObject({ ok: false, state: 'unconfigured', errors: [], kind: 'network', id: NET });
    expect(r.checks[0].ok).toBe(false);
    expect(handler.activated).toHaveLength(0);
    expect(store.configs.size).toBe(0);
  });

  test('static error -> 422 shaped, state of existing id kept', async () => {
    const { rt } = newRuntime();
    await rt.apply({ id: NET, values: valid });
    const r = await rt.apply({ id: NET, values: { RPC_URL: null } });
    expect(r).toMatchObject({ ok: false, id: NET, state: 'configured', errors: [expect.objectContaining({ path: 'RPC_URL', code: ERROR_CODES.required })] });
    expect(rt.resolve(NET)?.version).toBe(1);
  });

  test('activate throws -> state error, build-failed, lastError redacted, row kept', async () => {
    const store = new MemoryStore();
    const { rt, handler } = newRuntime({ store });
    handler.failActivate = new Error(`cannot connect with ${SECRET}`);
    const r = await rt.apply({ id: NET, values: { ...valid, RPC_AUTH: SECRET } });
    expect(r).toMatchObject({ ok: false, state: 'error', version: 1, id: NET });
    expect(r.errors).toEqual([{ path: '', code: ERROR_CODES.buildFailed, message: 'cannot connect with [redacted]' }]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(store.row(NET)).toBeDefined();
    expect(rt.resolve(NET)).toBeUndefined();
    expect(rt.networks()).toEqual([]);
    const d = await rt.describe();
    expect(d.readiness).toEqual({ ready: false, blocking: [`network/${NET}: cannot connect with [redacted]`] });
    expect(JSON.stringify(d)).not.toContain(SECRET);
  });

  test('activate throws -> handler is deactivated so nothing it registered stays live', async () => {
    const { rt, handler } = newRuntime();
    handler.failActivate = new Error('boom');
    const r = await rt.apply({ id: NET, values: valid });
    expect(r.state).toBe('error');
    expect(handler.deactivated).toEqual([net(NET)]);
    // remove tears it down again even though the entry has no active config
    await rt.remove(net(NET));
    expect(handler.deactivated).toEqual([net(NET), net(NET)]);
  });

  test('activate timeout -> error, and a late completion is deactivated', async () => {
    const handler = fakeHandler();
    let finish: () => void = () => {};
    handler.activate = () => new Promise((resolve) => { finish = () => resolve(); });
    const { rt } = newRuntime({ handler, activateTimeoutMs: 20 });
    const r = await rt.apply({ id: 'slow', values: valid });
    expect(r.state).toBe('error');
    expect(r.errors[0].message).toMatch(/timeout/);
    expect(handler.deactivated).toEqual([net('slow')]);
    finish();
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    expect(handler.deactivated).toEqual([net('slow'), net('slow')]);
  });

  test('re-apply: the previous config stays resolvable while the new one is being activated', async () => {
    const handler = fakeHandler();
    const { rt } = newRuntime({ handler });
    await rt.apply({ id: NET, values: valid });
    let finish: () => void = () => {};
    handler.activate = () => new Promise((resolve) => { finish = () => resolve(); });
    const applying = rt.apply({ id: NET, values: { TAG: 'x' } });
    await new Promise((resolve) => { setTimeout(resolve, 5); });
    expect(rt.stateOf(net(NET))).toBe('applying');
    expect(rt.resolve(NET)?.version).toBe(1);
    expect(rt.defaultOf('network')?.version).toBe(1);
    finish();
    await applying;
    expect(rt.resolve(NET)?.version).toBe(2);
    expect(rt.resolve(NET)?.values.TAG).toBe('x');
  });

  test('default: first network is default, explicit default moves the flag', async () => {
    const { rt, handler } = newRuntime();
    await rt.apply({ id: NET, values: valid });
    await rt.apply({ id: NET2, values: valid });
    expect(rt.list().map((c) => [c.id, c.isDefault])).toEqual([[NET, true], [NET2, false]]);
    expect(rt.defaultOf('network')?.id).toBe(NET);
    await rt.apply({ id: NET2, default: true, values: {} });
    expect(rt.list().map((c) => [c.id, c.isDefault])).toEqual([[NET, false], [NET2, true]]);
    expect(rt.resolve(NET)?.isDefault).toBe(false);
    expect(rt.defaultOf('network')?.id).toBe(NET2);
    expect(handler.activated.at(-1)?.isDefault).toBe(true);
  });

  test('implicit default is derived from the store: a second process never steals the flag', async () => {
    const store = new MemoryStore();
    const r1 = newRuntime({ store });
    await r1.rt.apply({ id: NET, values: valid });
    const r2 = newRuntime({ store });
    await r2.rt.apply({ id: NET2, values: valid });
    expect(store.row(NET)?.isDefault).toBe(true);
    expect(store.row(NET2)?.isDefault).toBe(false);
    expect(r1.rt.resolve(NET)?.isDefault).toBe(true);
    // an explicit default still moves the flag
    await r2.rt.apply({ id: NET2, default: true, values: {} });
    expect(store.row(NET)?.isDefault).toBe(false);
  });

  test('mutations are serialized', async () => {
    const { rt, handler } = newRuntime();
    const results = await Promise.all([rt.apply({ id: NET, values: valid }), rt.apply({ id: NET, values: { TAG: 'x' } })]);
    expect(results.map((r) => r.version)).toEqual([1, 2]);
    expect(handler.activated.map((c) => c.version)).toEqual([1, 2]);
  });
});

describe('ConfigRuntime.describe', () => {
  test('shape, secrets as { set }, no public key for browser sealing', async () => {
    const { rt } = newRuntime();
    const empty = await rt.describe();
    expect(empty).toEqual({
      protocol: 'adapter-config/2', adapter, pages, configs: [], readiness: { ready: false, blocking: ['no network configured yet'] },
    });
    expect(rt.declaredKinds()).toEqual(['network', 'custody']);
    expect(newRuntime({ pages: networkPages }).rt.declaredKinds()).toEqual(['network']);

    const r = await rt.apply({ id: NET, name: 'Mainnet', values: { ...valid, RPC_AUTH: SECRET } });
    expect(r.ok).toBe(true);
    const d = await rt.describe();
    expect(d.configs).toEqual([{
      kind: 'network', id: NET, name: 'Mainnet', state: 'configured', version: 1, lastError: undefined, isDefault: true,
      values: { RPC_URL: RPC, RPC_AUTH: { set: true }, OPERATOR_KEY: { set: true }, CUSTODY_API_KEY: { set: false } },
    }]);
    expect(JSON.stringify(d)).not.toContain(SECRET);
    expect(JSON.stringify(d)).not.toContain('0xabcdef');

    const withSealer = await newRuntime({ sealer: new TestSealer() }).rt.describe();
    expect(Object.keys(withSealer)).toEqual(['protocol', 'adapter', 'pages', 'configs', 'readiness']);
  });
});

describe('ConfigRuntime restore / remove / resolve', () => {
  test('restore activates stored configs (custody first), invalid ones end in error, bad secrets do not stop the rest', async () => {
    const store = new MemoryStore();
    const sealer = new TestSealer();
    const first = newRuntime({ store, sealer });
    await first.rt.apply({ id: NET, values: { ...valid, RPC_AUTH: SECRET } });
    await first.rt.apply({ id: NET2, values: valid });
    await first.rt.apply({ kind: 'custody', id: 'fb', values: validCustody });
    await store.save({ kind: 'network', id: 'invalid', name: 'invalid', isDefault: false, values: { RPC_URL: 'nope' }, secrets: {} });
    await store.save({
      kind: 'network', id: 'bad-secret', name: 'bad-secret', isDefault: false, values: { RPC_URL: RPC },
      secrets: { OPERATOR_KEY: sealWithPublicKey(await new TestSealer('test').publicKey(), 'test', 'x') },
    });
    await store.save({ kind: 'network', id: 'stale', name: 'stale', isDefault: false, values: { ...valid, REMOVED_FIELD: 'v' }, secrets: {} });
    await store.save({ kind: 'asset' as any, id: 'legacy', name: 'legacy', isDefault: false, values: {}, secrets: {} });

    const handler = fakeHandler();
    const second = new ConfigRuntime({ adapter, pages, handler, store, sealer, logger: silentLogger });
    await second.restore();
    expect(handler.activated.map((c) => `${c.kind}/${c.id}`)).toEqual(['custody/fb', `network/${NET}`, `network/${NET2}`, 'network/stale']);
    expect(handler.activated.find((c) => c.id === 'stale')?.values.REMOVED_FIELD).toBeUndefined();
    expect(handler.activated.find((c) => c.id === NET)?.secrets).toEqual({ OPERATOR_KEY: '0xabcdef', RPC_AUTH: SECRET });
    expect(handler.checkCalls).toHaveLength(0);
    const byId = Object.fromEntries(second.list().map((c) => [c.id, c]));
    expect(byId[NET].state).toBe('configured');
    expect(byId.invalid.state).toBe('error');
    expect(byId.invalid.values.RPC_URL).toBe('nope');
    expect(byId['bad-secret'].state).toBe('error');
    expect(byId['bad-secret'].lastError).toMatch(/OPERATOR_KEY/);
    expect(byId.legacy).toBeUndefined();
    expect(second.readiness().ready).toBe(true);
    expect(second.networks().sort()).toEqual([NET, NET2, 'stale'].sort());
  });

  test('restore with a failing store never throws', async () => {
    const store = new MemoryStore();
    store.list = async () => { throw new Error('db down'); };
    const { rt } = newRuntime({ store });
    await expect(rt.restore()).resolves.toBeUndefined();
  });

  test('remove: 404 unknown, 409 while the handler reports use, then ok', async () => {
    for (const store of [undefined, new MemoryStore()]) {
      const { rt, handler } = newRuntime({ store });
      await expect(rt.remove(net('zzz'))).rejects.toMatchObject({ status: 404, code: ERROR_CODES.notFound });
      await rt.apply({ id: NET, values: valid });
      handler.used.add(NET);
      await expect(rt.remove(net(NET))).rejects.toMatchObject({ status: 409, code: ERROR_CODES.inUse, message: expect.stringContaining(`assets on ${NET}`) });
      expect(rt.resolve(NET)).toBeDefined();
      handler.used.delete(NET);
      await rt.remove(net(NET));
      expect(handler.deactivated).toEqual([net(NET)]);
      expect(rt.resolve(NET)).toBeUndefined();
      expect(rt.list()).toEqual([]);
      if (store) expect(store.configs.size).toBe(0);
    }
  });

  test('remove without an inUse hook always succeeds', async () => {
    const handler = fakeHandler();
    delete handler.inUse;
    const { rt } = newRuntime({ handler });
    await rt.apply({ id: NET, values: valid });
    await expect(rt.remove(net(NET))).resolves.toBeUndefined();
  });

  test('remove: a row already deleted in the store is still dropped here', async () => {
    const store = new MemoryStore();
    const { rt, handler } = newRuntime({ store });
    await rt.apply({ id: NET, values: valid });
    await store.remove(net(NET));
    await rt.remove(net(NET));
    expect(handler.deactivated).toEqual([net(NET)]);
    expect(rt.resolve(NET)).toBeUndefined();
    expect(rt.list()).toEqual([]);
  });

  test('resolve: by ledger only, configured only, never another network', async () => {
    const { rt, handler } = newRuntime();
    await rt.apply({ id: NET, values: valid });
    await rt.apply({ id: NET2, values: valid });
    expect(rt.resolve(NET)?.id).toBe(NET);
    expect(rt.resolve(NET2)?.id).toBe(NET2);
    expect(rt.resolve('eip155:999')).toBeUndefined();
    expect(rt.defaultOf('network')?.id).toBe(NET);

    handler.failActivate = new Error('down');
    await rt.apply({ id: NET2, values: { TAG: 'x' } });
    expect(rt.resolve(NET2)).toBeUndefined();
    expect(rt.stateOf(net(NET2))).toBe('error');
    expect(rt.networks()).toEqual([NET]);
    // the other ledger is untouched
    expect(rt.resolve(NET)?.id).toBe(NET);
  });
});

describe('account kind (per-investor connection)', () => {
  const ACC = `${NET}:${ADDR}`;
  const UPPER = ADDR.toUpperCase().replace('0X', '0x');
  const SOL_LEDGER = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

  test('ids: CAIP-10, lowercase on eip155, longer than a name is allowed', () => {
    expect(ConfigRuntime.refOf('account', ACC)).toEqual({ kind: 'account', id: ACC });
    const rel = `eip155:2026041003:${ADDR}`;
    expect(ConfigRuntime.refOf('account', rel).id).toBe(rel);
    const sol = `${SOL_LEDGER}:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv`;
    expect(ConfigRuntime.refOf('account', sol).id).toBe(sol);
    for (const bad of [`${NET}:${UPPER}`, NET, `${NET}:`, 'fb', `${NET}:0xab/cd`, `${NET}:${'a'.repeat(129)}`, 42]) {
      expect(() => ConfigRuntime.refOf('account', bad)).toThrow(/CAIP-10/);
    }
    // the id rule of the other kinds is unchanged
    expect(() => ConfigRuntime.refOf('network', sol)).toThrow(ConfigRequestError);
  });

  test('accountConfigId lowercases an eip155 address only', () => {
    expect(accountConfigId(NET, UPPER)).toBe(ACC);
    expect(accountConfigId(SOL_LEDGER, 'AbC')).toBe(`${SOL_LEDGER}:AbC`);
  });

  test('apply: own page, never an implicit default, found by (ledger, address)', async () => {
    const { rt, handler } = newRuntime({ store: new MemoryStore(), pages: pagesWithAccount });
    await rt.apply({ id: NET, values: valid });
    const r = await rt.apply({ kind: 'account', id: ACC, values: { AUTH: 'bearer', TOKEN: SECRET } });
    expect(r).toMatchObject({ ok: true, kind: 'account', id: ACC, state: 'configured' });
    expect(handler.activated.at(-1)).toMatchObject({ kind: 'account', id: ACC, isDefault: false, values: { AUTH: 'bearer' }, secrets: { TOKEN: SECRET } });
    expect(rt.defaultOf('account')).toBeUndefined();
    expect(rt.account(NET, UPPER)?.id).toBe(ACC);
    expect(rt.account(NET2, ADDR)).toBeUndefined();
    expect(rt.account(NET, '0x0000000000000000000000000000000000000001')).toBeUndefined();
    expect(rt.resolve(NET)?.kind).toBe('network');
    // an account config does not make the adapter ready, a network does
    expect(rt.readiness().ready).toBe(true);

    // dtcc-wallet keeps no secret: TOKEN is hidden, so it is not required
    await rt.apply({ kind: 'account', id: `${NET2}:${ADDR}`, values: { AUTH: 'dtcc-wallet' } });
    expect(rt.account(NET2, ADDR)?.secrets).toEqual({});
    const missing = await rt.apply({ kind: 'account', id: `${NET2}:${ADDR}`, values: { AUTH: 'bearer' } });
    expect(missing.errors.map((e) => [e.path, e.code])).toEqual([['TOKEN', ERROR_CODES.required]]);

    // an explicit default is kept
    await rt.apply({ kind: 'account', id: `${NET2}:${ADDR}`, default: true, values: {} });
    expect(rt.defaultOf('account')?.id).toBe(`${NET2}:${ADDR}`);
    expect(rt.get(account(ACC))?.isDefault).toBe(false);
  });

  test('a kind with no pages on this adapter is refused', async () => {
    const { rt, handler } = newRuntime({ pages: networkPages });
    await expect(rt.apply({ kind: 'account', id: ACC, values: { AUTH: 'dtcc-wallet' } }))
      .rejects.toMatchObject({ status: 400, code: ERROR_CODES.badId, path: 'kind' });
    await expect(rt.validate({ kind: 'custody', values: {} })).rejects.toMatchObject({ status: 400, path: 'kind' });
    expect(handler.activated).toHaveLength(0);
  });

  test('restore: custody, then network, then account. A kind with no pages is skipped', async () => {
    const store = new MemoryStore();
    const first = newRuntime({ store, pages: pagesWithAccount });
    await first.rt.apply({ kind: 'account', id: ACC, values: { AUTH: 'dtcc-wallet' } });
    await first.rt.apply({ id: NET, values: valid });
    await first.rt.apply({ kind: 'custody', id: 'fb', values: validCustody });

    const handler = fakeHandler();
    const second = new ConfigRuntime({ adapter, pages: pagesWithAccount, handler, store, logger: silentLogger });
    await second.restore();
    expect(handler.activated.map((c) => `${c.kind}/${c.id}`)).toEqual(['custody/fb', `network/${NET}`, `account/${ACC}`]);
    expect(second.account(NET, ADDR)?.values).toEqual({ AUTH: 'dtcc-wallet' });

    const older = fakeHandler();
    const third = new ConfigRuntime({ adapter, pages, handler: older, store, logger: silentLogger });
    await third.restore();
    expect(older.activated.map((c) => c.kind)).toEqual(['custody', 'network']);
    expect(third.list().map((c) => c.kind)).toEqual(['custody', 'network']);
  });
});
