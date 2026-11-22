import express from 'express';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import winston from 'winston';
import { registerConfigRoutes } from '../../src/config/routes';
import { ConfigRuntime } from '../../src/config/runtime';
import { MemoryConfigStore } from '../../src/config/store';
import { WizardCall, WizardOperation, WizardRefusal } from '../../src/config/wizard/types';
import { adapter, fakeHandler, SECRET_KEYS, silentLogger, VERSION } from './support/fixtures';
import { envelope, MANIFEST, NETWORK } from './support/wizard';

interface Res { status: number; body: any; text: string; type: string | null }

const { fetch } = globalThis as unknown as {
  fetch: (url: string, init?: Record<string, unknown>) => Promise<{ status: number; text(): Promise<string>; headers: { get(n: string): string | null } }>;
};

const newRuntime = () => new ConfigRuntime({
  version: VERSION, adapter, secretKeys: SECRET_KEYS, handler: fakeHandler(), store: new MemoryConfigStore(), logger: silentLogger,
});

describe('wizard routes', () => {
  let server: Server;
  let base: string;
  let calls: WizardCall[];
  let operations: Record<string, WizardOperation>;

  const post = async (op: string, body: Buffer | string, headers: Record<string, string> = {}): Promise<Res> => {
    const res = await fetch(`${base}/config/operations/${op}`, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    return { status: res.status, body: parsed, text, type: res.headers.get('content-type') };
  };

  /** One step as the relay sends it: { context, input } and the key header when there is one. */
  const step = (op: string, input: Record<string, unknown> = {}, opts: { context?: object; idem?: string } = {}) =>
    post(op, envelope(input, opts.context), opts.idem ? { 'idempotency-key': opts.idem } : {});

  beforeEach(async () => {
    calls = [];
    const record = (output: Record<string, unknown>): WizardOperation => async (call) => { calls.push(call); return output; };
    operations = {
      'get-status': record({ state: 'active' }),
      check: async (call) => {
        calls.push(call);
        if (call.input.apiKey === 'ak_bad') throw new WizardRefusal('INVALID_CREDENTIALS', { field: '/apiKey' });
        return { valid: true };
      },
      activate: record({ state: 'active' }),
      'activate-network': record({ state: 'active' }),
    };
    const app = express();
    registerConfigRoutes(app, newRuntime(), {
      logger: winston.createLogger({ silent: true }),
      wizard: { manifest: MANIFEST, operations: new Proxy(operations, { get: (t, k: string) => t[k] }) },
    });
    await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('serves the manifest as JSON', async () => {
    const res = await fetch(`${base}/config/manifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(JSON.parse(await res.text())).toEqual(MANIFEST);
  });

  it('runs the status read and an integration step', async () => {
    const status = await step('get-status');
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ output: { state: 'active' } });
    expect(status.type).toMatch(/^application\/json/);

    const check = await step('check', { apiKey: 'ak_1' });
    expect(check.body).toEqual({ output: { valid: true } });
    expect(calls[1]).toEqual({ operationId: 'check', scope: 'integration', targetId: undefined, input: { apiKey: 'ak_1' } });
  });

  it('passes the network of a network step', async () => {
    const res = await step('activate-network', {}, { context: NETWORK, idem: randomUUID() });
    expect(res.status).toBe(200);
    expect(calls[0]).toMatchObject({ scope: 'network', targetId: 'eip155:31337' });
  });

  it.each([
    ['a network context for an integration operation', 'check', NETWORK],
    ['an integration context for a network operation', 'activate-network', { scope: 'integration' }],
    ['an undeclared network', 'activate-network', { ...NETWORK, targetId: 'eip155:1' }],
    ['another target kind', 'activate-network', { ...NETWORK, targetKind: 'wallet' }],
    ['an extra key', 'check', { scope: 'integration', org: 'bank-us' }],
  ])('refuses %s', async (_, op, context) => {
    const res = await step(op, { apiKey: 'ak_1' }, { context, idem: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'INVALID_CONTEXT' } });
    expect(calls).toHaveLength(0);
  });

  it('refuses a body that is not exactly { context, input }', async () => {
    for (const body of ['{', '[]', JSON.stringify({ input: {} }), JSON.stringify({ context: { scope: 'integration' }, input: {}, extra: 1 })]) {
      expect((await post('get-status', body)).body).toEqual({ error: { code: 'INVALID_REQUEST' } });
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses input outside the request schema with the field, and passes a refusal of the operation', async () => {
    const invalid = await step('check', { apiKey: 'nope' });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual({ error: { code: 'INVALID_INPUT', field: '/apiKey' } });

    const refused = await step('check', { apiKey: 'ak_bad' });
    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', field: '/apiKey' } });
  });

  it('checks the Idempotency-Key header', async () => {
    expect((await step('activate', { apiKey: 'ak_1' })).body).toEqual({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } });
    expect((await step('activate', { apiKey: 'ak_1' }, { idem: randomUUID().toUpperCase() })).body).toEqual({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } });
    expect((await step('check', { apiKey: 'ak_1' }, { idem: 'not-a-uuid' })).body).toEqual({ error: { code: 'INVALID_IDEMPOTENCY_KEY' } });
    expect(calls).toHaveLength(0);
  });

  it('runs a keyed step once and refuses the key for another body', async () => {
    const idem = randomUUID();
    const first = await step('activate', { apiKey: 'ak_1' }, { idem });
    const retry = await step('activate', { apiKey: 'ak_1' }, { idem });
    expect([first.status, retry.status]).toEqual([200, 200]);
    expect(retry.body).toEqual(first.body);
    expect(calls).toHaveLength(1);
    const other = await step('activate', { apiKey: 'ak_2' }, { idem });
    expect(other.status).toBe(409);
    expect(other.body).toEqual({ error: { code: 'IDEMPOTENCY_KEY_REUSED' } });
  });

  it('does not keep a refusal, so a retry with the same key runs again', async () => {
    let attempts = 0;
    operations.activate = async (call) => {
      calls.push(call);
      attempts += 1;
      if (attempts === 1) throw new WizardRefusal('INVALID_CREDENTIALS', { field: '/apiKey' });
      return { state: 'active' };
    };
    const idem = randomUUID();
    expect((await step('activate', { apiKey: 'ak_1' }, { idem })).status).toBe(422);
    expect((await step('activate', { apiKey: 'ak_1' }, { idem })).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('answers 500 for an output outside the response schema or a thrown error, without the message', async () => {
    operations['get-status'] = async () => ({ state: 'x'.repeat(40) });
    const invalid = await step('get-status');
    expect(invalid.status).toBe(500);
    expect(invalid.body).toEqual({ error: { code: 'RESPONSE_INVALID' } });

    operations['get-status'] = async () => { throw new Error('secret value 0xabc'); };
    const thrown = await step('get-status');
    expect(thrown.body).toEqual({ error: { code: 'INTERNAL_ERROR' } });
    expect(thrown.text).not.toContain('0xabc');
  });

  it('refuses an unknown operation, another content type and a body over the limit', async () => {
    expect((await post('nope', envelope({}))).status).toBe(404);
    expect((await post('check', envelope({}), { 'content-type': 'text/plain' })).status).toBe(415);
    const large = await step('check', { apiKey: `ak_${'x'.repeat(9000)}` });
    expect(large.status).toBe(413);
    expect(large.body).toEqual({ error: { code: 'REQUEST_TOO_LARGE' } });
  });

  it('keeps POST /config on its JSON parser next to the wizard routes', async () => {
    const res = await fetch(`${base}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: 'other/1' }) });
    expect(res.status).toBe(409);
    const bad = await fetch(`${base}/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(bad.status).toBe(400);
  });
});

describe('wizard start', () => {
  const register = (manifest: unknown, operations: Record<string, WizardOperation>) =>
    registerConfigRoutes(express(), newRuntime(), { wizard: { manifest, operations } });
  const ok: WizardOperation = async () => ({});
  const all = Object.fromEntries(Object.keys(MANIFEST.operations).map((op) => [op, ok]));

  it('refuses a manifest Control Center would refuse, and a missing handler', () => {
    expect(() => register({ ...MANIFEST, adapter: { ...MANIFEST.adapter, imageDigest: 'sha256:00' } }, all)).toThrow('the wizard manifest is not valid: adapter');
    expect(() => register({ ...MANIFEST, signature: 'x' }, all)).toThrow('the wizard manifest is not valid: top-level keys');
    expect(() => register({ ...MANIFEST, compatibility: { hostContract: 3 } }, all)).toThrow('compatibility.hostContract');
    expect(() => register(MANIFEST, {})).toThrow('no handler for wizard operation(s): get-status, check, activate, activate-network');
  });
});
