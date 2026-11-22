import { sealWithPublicKey } from '../../src/config/envelope';
import { ConfigRequestError, ConfigRuntime, PLAIN_KID, redact } from '../../src/config/runtime';
import { MemoryConfigStore } from '../../src/config/store';
import { ERROR_CODES, isSealedValue, SealedValue } from '../../src/config/types';
import {
  adapter, API_KEY, fakeHandler, KEY, NET, NET2, RPC, SECRET_KEYS, silentLogger, VERSION,
} from './support/fixtures';
import { TestSealer } from './support/test-sealer';

const newRuntime = (extra: Partial<ConstructorParameters<typeof ConfigRuntime>[0]> = {}) => {
  const handler = (extra.handler ?? fakeHandler()) as ReturnType<typeof fakeHandler>;
  const rt = new ConfigRuntime({ version: VERSION, adapter, secretKeys: SECRET_KEYS, handler, logger: silentLogger, ...extra });
  return { rt, handler };
};

const ledger = { rpcUrl: RPC, chainId: 1, operatorKey: KEY };

describe('ConfigRuntime.describe', () => {
  test('before any apply: version, adapter, unconfigured, revision 0, no values', async () => {
    const { rt } = newRuntime();
    expect(await rt.describe()).toEqual({
      protocol: 'adapter-config/3', version: VERSION, adapter, state: 'unconfigured', revision: 0, ledgers: {},
    });
    expect(rt.ready()).toBe(false);
  });

  test('after an apply: the configured values, secrets as { set: true } in every section', async () => {
    const { rt } = newRuntime();
    await rt.apply({ ledgers: { [NET]: ledger }, custody: { provider: 'fireblocks', apiKey: API_KEY } });
    const d = await rt.describe();
    expect(d).toEqual({
      protocol: 'adapter-config/3', version: VERSION, adapter, state: 'configured', revision: 1,
      ledgers: { [NET]: { rpcUrl: RPC, chainId: 1, operatorKey: { set: true } } },
      custody: { provider: 'fireblocks', apiKey: { set: true } },
    });
    expect(JSON.stringify(d)).not.toContain(KEY);
    expect(JSON.stringify(d)).not.toContain(API_KEY);
    expect(rt.ready()).toBe(true);
  });
});

describe('ConfigRuntime.apply', () => {
  test('the handler gets the plaintext config, private keys as they were sent', async () => {
    const { rt, handler } = newRuntime();
    const r = await rt.apply({ version: VERSION, ledgers: { [NET]: ledger } }, 'me@test');
    expect(r).toEqual({ ok: true, applied: true, revision: 1, state: 'configured', errors: [] });
    expect(handler.validated).toEqual([{ ledgers: { [NET]: ledger } }]);
    expect(handler.applied).toEqual([{ config: { ledgers: { [NET]: ledger } }, previous: undefined }]);
    expect(rt.current()).toEqual({ ledgers: { [NET]: ledger } });
    expect(rt.ledger(NET)?.operatorKey).toBe(KEY);
  });

  test('merge: omitted keeps, null and "" clear a key, null drops a ledger or the custody section', async () => {
    const { rt, handler } = newRuntime();
    await rt.apply({ ledgers: { [NET]: ledger, [NET2]: { rpcUrl: RPC } }, custody: { provider: 'kms' } });
    await rt.apply({ ledgers: { [NET]: { rpcUrl: 'https://other.example', chainId: null } } });
    expect(rt.current()).toEqual({
      ledgers: { [NET]: { rpcUrl: 'https://other.example', operatorKey: KEY }, [NET2]: { rpcUrl: RPC } },
      custody: { provider: 'kms' },
    });
    expect(handler.applied.at(-1)?.previous?.ledgers[NET].chainId).toBe(1);
    await rt.apply({ ledgers: { [NET2]: null }, custody: null });
    expect(rt.current()).toEqual({ ledgers: { [NET]: { rpcUrl: 'https://other.example', operatorKey: KEY } } });
    await rt.apply({ ledgers: { [NET]: { rpcUrl: '', operatorKey: null } } });
    expect(rt.current()).toEqual({ ledgers: {} });
    expect((await rt.describe()).revision).toBe(4);
  });

  test('a patch that changes nothing is not applied again', async () => {
    const { rt, handler } = newRuntime();
    await rt.apply({ ledgers: { [NET]: ledger } });
    const r = await rt.apply({ ledgers: { [NET]: { chainId: 1, rpcUrl: RPC } } });
    expect(r).toEqual({ ok: true, applied: false, revision: 1, state: 'configured', errors: [] });
    expect(await rt.apply({})).toMatchObject({ ok: true, applied: false });
    expect(handler.applied).toHaveLength(1);
    expect(handler.validated).toHaveLength(1);
  });

  test('a patch for another config version is refused with 409', async () => {
    const { rt, handler } = newRuntime();
    await expect(rt.apply({ version: 'test-config/2', ledgers: { [NET]: ledger } }))
      .rejects.toMatchObject({ status: 409, code: ERROR_CODES.versionMismatch });
    expect(handler.applied).toHaveLength(0);
  });

  test('a malformed body is refused with 400', async () => {
    const { rt } = newRuntime();
    for (const body of [null, [], 'x', { accounts: {} }, { ledgers: [] }, { ledgers: 'x' }, { custody: 'x' }]) {
      await expect(rt.apply(body)).rejects.toThrow(ConfigRequestError);
    }
    await expect(rt.apply({ accounts: {} })).rejects.toMatchObject({ status: 400, code: ERROR_CODES.badRequest });
  });

  test('bad ledger ids, bad keys and non-scalar values are 422-shaped errors, nothing is applied', async () => {
    const { rt, handler } = newRuntime();
    const r = await rt.apply({
      ledgers: { inmemory: { rpcUrl: RPC }, [NET]: { 'bad-key': 'x', nested: { a: 1 }, list: [1] }, [NET2]: 'x' },
      custody: { provider: 7, keys: { a: 1 } },
    } as any);
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['ledgers.inmemory', ERROR_CODES.badLedger],
      [`ledgers.${NET}.bad-key`, ERROR_CODES.badKey],
      [`ledgers.${NET}.nested`, ERROR_CODES.type],
      [`ledgers.${NET}.list`, ERROR_CODES.type],
      [`ledgers.${NET2}`, ERROR_CODES.type],
      ['custody.keys', ERROR_CODES.type],
    ]);
    expect(handler.validated).toHaveLength(0);
    expect(handler.applied).toHaveLength(0);
  });

  test('validate errors refuse the config, without the secret in the message', async () => {
    const { rt, handler } = newRuntime();
    handler.validateErrors = [{ path: `ledgers.${NET}.operatorKey`, code: 'invalid-key', message: `key ${KEY} has no funds` }];
    const r = await rt.apply({ ledgers: { [NET]: ledger } });
    expect(r).toMatchObject({ ok: false, applied: false, revision: 0, state: 'unconfigured' });
    expect(r.errors).toEqual([{ path: `ledgers.${NET}.operatorKey`, code: 'invalid-key', message: 'key *** has no funds' }]);
    expect(handler.applied).toHaveLength(0);
  });

  test('a failing apply re-applies the previous config, stores nothing and redacts the message', async () => {
    const store = new MemoryConfigStore();
    const { rt, handler } = newRuntime({ store });
    await rt.apply({ ledgers: { [NET]: ledger } });
    handler.failApply = new Error(`cannot reach https://user:pw@rpc.example with ${API_KEY}`);
    handler.failOnce = true;
    const r = await rt.apply({ custody: { provider: 'fireblocks', apiKey: API_KEY } });
    expect(r).toMatchObject({ ok: false, applied: false, revision: 1, state: 'configured' });
    expect(r.errors).toEqual([{ path: '', code: ERROR_CODES.applyFailed, message: 'cannot reach https://***@rpc.example with ***' }]);
    // rollback: the previous config is applied again, with the refused one as `previous`
    expect(handler.applied.at(-1)).toEqual({ config: { ledgers: { [NET]: ledger } }, previous: { ledgers: { [NET]: ledger }, custody: { provider: 'fireblocks', apiKey: API_KEY } } });
    expect(rt.current()).toEqual({ ledgers: { [NET]: ledger } });
    expect((await store.load())?.revision).toBe(1);
    expect((await rt.describe()).lastError).toContain('***');
  });

  test('a failing first apply keeps the adapter unconfigured with the error', async () => {
    const { rt, handler } = newRuntime();
    handler.failApply = new Error('rpc down');
    const r = await rt.apply({ ledgers: { [NET]: ledger } });
    expect(r).toMatchObject({ ok: false, state: 'unconfigured', revision: 0 });
    expect(await rt.describe()).toMatchObject({ state: 'unconfigured', lastError: 'rpc down', ledgers: {} });
  });

  test('a failing rollback leaves state error', async () => {
    const { rt, handler } = newRuntime();
    await rt.apply({ ledgers: { [NET]: ledger } });
    handler.failApply = new Error('down');
    const r = await rt.apply({ ledgers: { [NET2]: { rpcUrl: RPC } } });
    expect(r).toMatchObject({ ok: false, state: 'error' });
    expect(rt.ready()).toBe(false);
  });

  test('without validate the config is applied after the merge', async () => {
    const { rt, handler } = newRuntime({ handler: fakeHandler({ withValidate: false }) });
    expect(await rt.apply({ ledgers: { [NET]: ledger } })).toMatchObject({ ok: true, applied: true });
    expect(handler.applied).toHaveLength(1);
  });

  test('applies run one at a time', async () => {
    const { rt } = newRuntime();
    const results = await Promise.all([
      rt.apply({ ledgers: { [NET]: ledger } }),
      rt.apply({ ledgers: { [NET2]: { rpcUrl: RPC } } }),
    ]);
    expect(results.map((r) => r.revision)).toEqual([1, 2]);
    expect(Object.keys(rt.current()?.ledgers ?? {}).sort()).toEqual([NET, NET2]);
  });
});

describe('secrets at rest', () => {
  test('with a sealer: secret keys are sealed in the store, other values are kept as sent', async () => {
    const store = new MemoryConfigStore();
    const sealer = new TestSealer();
    const { rt } = newRuntime({ store, sealer });
    await rt.apply({ ledgers: { [NET]: ledger }, custody: { provider: 'fireblocks', apiKey: API_KEY } }, 'me@test');
    const doc = await store.load();
    expect(doc).toMatchObject({ version: VERSION, revision: 1, actor: 'me@test' });
    expect(doc?.ledgers[NET]).toMatchObject({ rpcUrl: RPC, chainId: 1 });
    expect(isSealedValue(doc?.ledgers[NET].operatorKey)).toBe(true);
    expect((doc?.ledgers[NET].operatorKey as SealedValue).kid).toBe('test');
    expect(isSealedValue(doc?.custody?.apiKey)).toBe(true);
    expect(JSON.stringify(doc)).not.toContain(KEY);
    expect(JSON.stringify(doc)).not.toContain(API_KEY);
  });

  test('without a sealer: the plain pseudo envelope (dev only), still not the plaintext', async () => {
    const store = new MemoryConfigStore();
    const { rt } = newRuntime({ store });
    await rt.apply({ ledgers: { [NET]: ledger } });
    const doc = await store.load();
    expect((doc?.ledgers[NET].operatorKey as SealedValue).kid).toBe(PLAIN_KID);
    expect(JSON.stringify(doc)).not.toContain(KEY);
  });
});

describe('ConfigRuntime.restore', () => {
  test('applies the stored config with opened secrets, keeps the revision', async () => {
    const store = new MemoryConfigStore();
    const sealer = new TestSealer();
    const first = newRuntime({ store, sealer });
    await first.rt.apply({ ledgers: { [NET]: ledger } });
    await first.rt.apply({ custody: { provider: 'fireblocks', apiKey: API_KEY } });

    const second = newRuntime({ store, sealer });
    await second.rt.restore();
    expect(second.handler.validated).toHaveLength(0);
    expect(second.handler.applied).toEqual([{
      config: { ledgers: { [NET]: ledger }, custody: { provider: 'fireblocks', apiKey: API_KEY } }, previous: undefined,
    }]);
    expect(await second.rt.describe()).toMatchObject({ state: 'configured', revision: 2, custody: { apiKey: { set: true } } });
    // the next patch merges into the restored config
    await second.rt.apply({ ledgers: { [NET]: { chainId: 5 } } });
    expect(second.rt.ledger(NET)).toEqual({ ...ledger, chainId: 5 });
  });

  test('an empty store leaves the adapter unconfigured', async () => {
    const { rt, handler } = newRuntime({ store: new MemoryConfigStore() });
    await rt.restore();
    expect(handler.applied).toHaveLength(0);
    expect((await rt.describe()).state).toBe('unconfigured');
  });

  test('a secret this adapter cannot open: state error, the values stay visible, a patch can fix it', async () => {
    const store = new MemoryConfigStore();
    const foreign = sealWithPublicKey(await new TestSealer('test').publicKey(), 'test', KEY);   // same kid, other key
    await store.save({ version: VERSION, ledgers: { [NET]: { rpcUrl: RPC, operatorKey: foreign } } });
    const { rt, handler } = newRuntime({ store, sealer: new TestSealer() });
    await rt.restore();
    const d = await rt.describe();
    expect(d).toMatchObject({ state: 'error', revision: 1, ledgers: { [NET]: { rpcUrl: RPC, operatorKey: { set: true } } } });
    expect(d.lastError).toMatch(new RegExp(`ledgers.${NET}.operatorKey`));
    expect(JSON.stringify(d)).not.toContain(KEY);
    expect(handler.applied).toHaveLength(0);
    // resend only the secret: the non-secret values of the stored config are the base
    expect(await rt.apply({ ledgers: { [NET]: { operatorKey: KEY } } })).toMatchObject({ ok: true, applied: true, revision: 2 });
    expect(rt.ledger(NET)).toEqual({ rpcUrl: RPC, operatorKey: KEY });
  });

  test('a failing apply on boot: state error, redacted message', async () => {
    const store = new MemoryConfigStore();
    await newRuntime({ store }).rt.apply({ ledgers: { [NET]: ledger } });
    const handler = fakeHandler();
    handler.failApply = new Error(`bad key ${KEY}`);
    const { rt } = newRuntime({ store, handler });
    await rt.restore();
    expect(await rt.describe()).toMatchObject({ state: 'error', lastError: 'bad key ***' });
  });

  test('a failing store load never throws', async () => {
    const store = new MemoryConfigStore();
    store.load = async () => { throw new Error('db down'); };
    const { rt } = newRuntime({ store });
    await expect(rt.restore()).resolves.toBeUndefined();
    expect(await rt.describe()).toMatchObject({ state: 'error', lastError: 'cannot load the stored config: db down' });
  });
});

describe('redact', () => {
  test('url credentials and secrets, longest first', () => {
    expect(redact('https://u:p@h/x secret-long secret', ['secret', 'secret-long'])).toBe('https://***@h/x *** ***');
    expect(redact('abc', ['ab'])).toBe('abc');   // values under 4 chars are not replaced
  });
});
