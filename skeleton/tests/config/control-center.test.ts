import express from 'express';
import { randomUUID } from 'node:crypto';
import winston from 'winston';
import { ControlCenterCall, ControlCenterOperationHandler, registerConfigRoutes } from '../../src/config';
import { envelope, MANIFEST, NETWORK } from './support/control-center';
import { serve } from './support/http';
import { MemoryConfigurationService } from './support/service';

const silent = winston.createLogger({ silent: true });
const refuse = (code: string, extra: { status?: number; field?: string; retryable?: boolean } = {}) => Object.assign(new Error(code), { code, ...extra });

describe('Control Center routes', () => {
  let calls: ControlCenterCall[];
  let operations: Record<string, ControlCenterOperationHandler>;
  let s: Awaited<ReturnType<typeof serve>>;

  const post = (op: string, body: Buffer | string, headers: Record<string, string> = {}) =>
    s.request('POST', `/config/operations/${op}`, body, { 'content-type': 'application/json; charset=utf-8', ...headers });
  const step = (op: string, input: Record<string, unknown> = {}, opts: { context?: object; headers?: Record<string, string> } = {}) =>
    post(op, envelope(input, opts.context), opts.headers);

  beforeEach(async () => {
    calls = [];
    const record = (output: Record<string, unknown>): ControlCenterOperationHandler => async (call) => { calls.push(call); return output; };
    operations = {
      'get-status': record({ state: 'active' }),
      check: async (call) => {
        calls.push(call);
        if (call.input.apiKey === 'ak_bad') throw refuse('INVALID_CREDENTIALS', { field: '/apiKey' });
        return { valid: true };
      },
      activate: record({ state: 'active' }),
      'activate-network': record({ state: 'active' }),
    };
    const app = express();
    // handlers looked up per call, so a test can swap one
    registerConfigRoutes(app, new MemoryConfigurationService(), {
      logger: silent,
      controlCenter: { manifest: MANIFEST, operations: new Proxy(operations, { get: (t, k: string) => t[k] }) },
    });
    s = await serve(app);
  });

  afterEach(() => s.close());

  it('serves the manifest as JSON', async () => {
    const res = await s.request('GET', '/config/manifest');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^application\/json/);
    expect(res.body).toEqual(MANIFEST);
  });

  it('runs the status read and an integration step', async () => {
    const status = await step('get-status');
    expect(status).toMatchObject({ status: 200, body: { output: { state: 'active' } } });
    expect(status.type).toMatch(/^application\/json/);

    const check = await step('check', { apiKey: 'ak_1' });
    expect(check.body).toEqual({ output: { valid: true } });
    expect(calls[1]).toEqual({ scope: 'integration', input: { apiKey: 'ak_1' } });
  });

  it('passes the network of a network step', async () => {
    const res = await step('activate-network', {}, { context: NETWORK });
    expect(res.status).toBe(200);
    expect(calls[0]).toEqual({ scope: 'network', targetId: 'eip155:31337', input: {} });
  });

  it('ignores an Idempotency-Key: a repeated key runs again, an invalid one is not refused', async () => {
    const key = randomUUID();
    expect((await step('activate', { apiKey: 'ak_1' }, { headers: { 'idempotency-key': key } })).status).toBe(200);
    expect((await step('activate', { apiKey: 'ak_2' }, { headers: { 'idempotency-key': key } })).status).toBe(200);
    expect((await step('check', { apiKey: 'ak_1' }, { headers: { 'idempotency-key': 'not-a-uuid' } })).status).toBe(200);
    expect(calls.map((c) => c.input.apiKey)).toEqual(['ak_1', 'ak_2', 'ak_1']);
  });

  it.each([
    ['a network context for an integration operation', 'check', NETWORK],
    ['an integration context for a network operation', 'activate-network', { scope: 'integration' }],
    ['an undeclared network', 'activate-network', { ...NETWORK, targetId: 'eip155:1' }],
    ['another target kind', 'activate-network', { ...NETWORK, targetKind: 'wallet' }],
    ['an extra key', 'check', { scope: 'integration', org: 'bank-us' }],
  ])('refuses %s', async (_, op, context) => {
    const res = await step(op, { apiKey: 'ak_1' }, { context });
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'INVALID_CONTEXT' } } });
    expect(calls).toHaveLength(0);
  });

  it('refuses a body that is not exactly { context, input } in UTF-8 without a BOM', async () => {
    const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), envelope({})]);
    for (const body of ['{', '[]', JSON.stringify({ input: {} }), JSON.stringify({ context: { scope: 'integration' }, input: {}, extra: 1 }), bom, Buffer.from([0xff, 0xfe])]) {
      expect((await post('get-status', body)).body).toEqual({ error: { code: 'INVALID_REQUEST' } });
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses input outside the request schema with the field pointer', async () => {
    expect(await step('check', { apiKey: 'nope' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/apiKey' } } });
    expect(await step('check', { apiKey: 'ak_1', other: 'x' })).toMatchObject({ status: 400, body: { error: { code: 'INVALID_INPUT', field: '/other' } } });
    expect(calls).toHaveLength(0);
  });

  it('answers a structural refusal: any thrown object with a code, 422 by default, with status, field and retryable', async () => {
    expect(await step('check', { apiKey: 'ak_bad' })).toMatchObject({ status: 422, body: { error: { code: 'INVALID_CREDENTIALS', field: '/apiKey' } } });

    operations.activate = async () => { throw { code: 'CONFIG_INCOMPLETE', status: 409 }; };
    expect((await step('activate', { apiKey: 'ak_1' })).body).toEqual({ error: { code: 'CONFIG_INCOMPLETE' } });
    expect((await step('activate', { apiKey: 'ak_1' })).status).toBe(409);

    operations.activate = async () => { throw refuse('UPSTREAM_DOWN', { status: 503, retryable: true, field: 'not a pointer' }); };
    expect(await step('activate', { apiKey: 'ak_1' })).toMatchObject({ status: 503, body: { error: { code: 'UPSTREAM_DOWN', retryable: true } } });
    expect((await step('activate', { apiKey: 'ak_1' })).body.error).not.toHaveProperty('field');
  });

  it('answers 500 INTERNAL_ERROR for a thrown error without a valid code, without its message', async () => {
    for (const thrown of [new Error('secret value 0xabc'), { code: 'lower_case 0xabc' }, { code: 7 }, 'secret 0xabc']) {
      operations['get-status'] = async () => { throw thrown; };
      const res = await step('get-status');
      expect(res).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL_ERROR' } } });
      expect(res.text).not.toContain('0xabc');
    }
  });

  it('answers 500 RESPONSE_INVALID for an output outside the response schema', async () => {
    operations['get-status'] = async () => ({ state: 'x'.repeat(40) });
    expect(await step('get-status')).toMatchObject({ status: 500, body: { error: { code: 'RESPONSE_INVALID' } } });
  });

  it('refuses an unknown operation, another content type and a body over the limit', async () => {
    expect(await post('nope', envelope({}))).toMatchObject({ status: 404, body: { error: { code: 'NOT_FOUND' } } });
    expect(await post('check', envelope({}), { 'content-type': 'text/plain' })).toMatchObject({ status: 415, body: { error: { code: 'UNSUPPORTED_MEDIA_TYPE' } } });
    expect(await step('check', { apiKey: `ak_${'x'.repeat(9000)}` })).toMatchObject({ status: 413, body: { error: { code: 'REQUEST_TOO_LARGE' } } });
    expect(await step('check', { apiKey: `ak_${'x'.repeat(70 * 1024)}` })).toMatchObject({ status: 413, body: { error: { code: 'REQUEST_TOO_LARGE' } } });
    expect(calls).toHaveLength(0);
  });

  it('keeps the field API on its JSON parser next to the raw operations', async () => {
    expect((await s.request('PUT', '/config/values', { values: { 'custody.url': 'https://c' } })).status).toBe(200);
    expect((await step('get-status')).status).toBe(200);
  });
});

describe('Control Center start', () => {
  const register = (manifest: unknown, operations: Record<string, ControlCenterOperationHandler>) =>
    registerConfigRoutes(express(), new MemoryConfigurationService(), { logger: silent, controlCenter: { manifest, operations } });
  const ok: ControlCenterOperationHandler = async () => ({});
  const all = Object.fromEntries(Object.keys(MANIFEST.operations).map((op) => [op, ok]));

  it('refuses a manifest Control Center would refuse, one declaring idempotency, and a missing handler', () => {
    expect(() => register({ ...MANIFEST, adapter: { ...MANIFEST.adapter, imageDigest: 'sha256:00' } }, all)).toThrow('the Control Center manifest is not valid: adapter');
    expect(() => register({ ...MANIFEST, signature: 'x' }, all)).toThrow('the Control Center manifest is not valid: top-level keys');
    expect(() => register({ ...MANIFEST, compatibility: { hostContract: 3 } }, all)).toThrow('compatibility.hostContract');
    const keyed = { ...MANIFEST, operations: { ...MANIFEST.operations, activate: { ...MANIFEST.operations.activate, idempotency: 'required' } } };
    expect(() => register(keyed, all)).toThrow('the Control Center manifest is not valid: operations.activate.idempotency');
    expect(() => register(MANIFEST, {})).toThrow('no handler for Control Center operation(s): get-status, check, activate, activate-network');
  });

  it('starts with no Control Center at all: no manifest route', async () => {
    const app = express();
    registerConfigRoutes(app, new MemoryConfigurationService(), { logger: silent });
    const s = await serve(app);
    try {
      expect((await s.request('GET', '/config/manifest')).status).toBe(404);
      expect((await s.request('GET', '/config/status')).status).toBe(200);
    } finally { await s.close(); }
  });
});
